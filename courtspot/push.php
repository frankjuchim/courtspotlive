<?php
/*
	CourtSpot Liveticker – Push-Dienst (CourtSpot-Erweiterung)

	Liest laufend die CourtSpot-Datenbank (Tabellen Verwaltung, Spiele, Courts)
	und schickt den Stand per HTTP(S) an den CourtSpot Liveticker. Läuft als
	systemd-Dienst "courtspot-liveticker" (Benutzer www-data), es muss also KEIN
	Browserfenster offen bleiben.

	Einstellungen kommen aus dem CourtSpot-Hauptmenü („3. Liveticker“):
	  $STATUS_DIR/config.json   { "url": …, "token": …, "courtspotDir": … }
	  $STATUS_DIR/aus           vorhanden = ausgeschaltet (keine Spieldaten senden)
	Ersatzweise (ältere Installationen): /etc/courtspot-liveticker.conf.php mit
	$PUSH_URL, $PUSH_TOKEN, $COURTSPOT_DIR.
	Den aktuellen Zustand schreibt der Dienst nach $STATUS_DIR/status.json.

	Aufruf:  php push.php            (Dauerbetrieb)
	         php push.php --once     (einmal senden, zum Testen)
	         php push.php --dry-run  (nur ausgeben, nichts senden)
*/

define('AGENT_VERSION', 2);
$STATUS_DIR = getenv('LIVETICKER_DIR') ?: '/var/lib/courtspot-liveticker';
$LEGACY_CONF = getenv('LIVETICKER_CONFIG') ?: '/etc/courtspot-liveticker.conf.php';
$INTERVAL = 1.0;
$HEARTBEAT = 30;

$once = in_array('--once', $argv);
$dryRun = in_array('--dry-run', $argv);

// Einstellungen bei jedem Durchlauf neu lesen – Änderungen im Menü gelten sofort
function settings()
{
	global $STATUS_DIR, $LEGACY_CONF;
	$cfg = array('url' => '', 'token' => '', 'courtspotDir' => '/var/www/html/oberliga', 'source' => 'none');
	if (is_readable($LEGACY_CONF))
	{
		$PUSH_URL = $PUSH_TOKEN = $COURTSPOT_DIR = null;
		$DB_OVERRIDE = null;
		include $LEGACY_CONF;
		if ($PUSH_URL && $PUSH_TOKEN && strpos($PUSH_TOKEN, 'HIER-EIN-LANGES') === false)
		{
			$cfg['url'] = $PUSH_URL;
			$cfg['token'] = $PUSH_TOKEN;
			$cfg['source'] = 'datei';
		}
		if ($COURTSPOT_DIR)
			$cfg['courtspotDir'] = $COURTSPOT_DIR;
		if ($DB_OVERRIDE)
			$cfg['dbOverride'] = $DB_OVERRIDE;
	}
	$json = @json_decode(@file_get_contents($STATUS_DIR.'/config.json'), true);
	if (is_array($json))
	{
		if (!empty($json['url']) && !empty($json['token']))
		{
			$cfg['url'] = $json['url'];
			$cfg['token'] = $json['token'];
			$cfg['source'] = 'menue';
		}
		if (!empty($json['courtspotDir']))
			$cfg['courtspotDir'] = $json['courtspotDir'];
	}
	$cfg['url'] = rtrim($cfg['url'], '/');
	return $cfg;
}

// DB-Zugangsdaten wie die CourtSpot-Weboberfläche aus DB_connection.php lesen,
// damit ein Wechsel der Datenbank ($CS_name) automatisch übernommen wird.
function dbConfig($cfg)
{
	$file = $cfg['courtspotDir'].'/DB_connection.php';
	if (!is_readable($file))
		return null;
	include $file;
	$db = array(
		'host' => preg_replace('/^p:/', '', $DB_adress),
		'user' => $DB_name,
		'pass' => $DB_pass,
		'name' => $CS_name,
		'port' => intval($DB_port),
	);
	if (!empty($cfg['dbOverride']))
		$db = array_merge($db, $cfg['dbOverride']);
	return $db;
}

$status = array('fehler' => null, 'letzteUebertragung' => null);

function logMsg($msg)
{
	fwrite(STDERR, date('Y-m-d H:i:s').' '.$msg."\n");
}

function fehler($msg)
{
	global $status;
	// Gleiche Meldung nicht jede Sekunde ins Log schreiben
	if ($status['fehler'] !== $msg)
		logMsg($msg);
	$status['fehler'] = $msg;
}

function ausgeschaltet()
{
	global $STATUS_DIR;
	clearstatcache();
	return file_exists($STATUS_DIR.'/aus');
}

function statusSchreiben($aktiv, $cfg)
{
	global $STATUS_DIR, $status, $dryRun;
	if ($dryRun || !is_dir($STATUS_DIR))
		return;
	$data = json_encode(array(
		'ts' => time(),
		'version' => AGENT_VERSION,
		'aktiv' => $aktiv,
		'eingerichtet' => $cfg['url'] !== '' && $cfg['token'] !== '',
		'letzteUebertragung' => $status['letzteUebertragung'],
		'fehler' => $status['fehler'],
		'url' => $cfg['url'],
		'quelle' => $cfg['source'],
		'courtspotDir' => $cfg['courtspotDir'],
	), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
	$tmp = $STATUS_DIR.'/status.json.tmp';
	if (@file_put_contents($tmp, $data) !== false)
		@rename($tmp, $STATUS_DIR.'/status.json');
}

function connect($cfg)
{
	$db = dbConfig($cfg);
	if ($db === null)
	{
		fehler('CourtSpot nicht gefunden: '.$cfg['courtspotDir'].'/DB_connection.php');
		return null;
	}
	mysqli_report(MYSQLI_REPORT_OFF);
	$link = @mysqli_connect($db['host'], $db['user'], $db['pass'], $db['name'], $db['port']);
	if (!$link)
	{
		fehler('DB-Verbindung fehlgeschlagen ('.$db['name'].'): '.mysqli_connect_error());
		return null;
	}
	mysqli_set_charset($link, 'utf8');
	return array($link, $db['name'], $cfg['courtspotDir']);
}

function fetchAll($db, $sql)
{
	$res = mysqli_query($db, $sql);
	if ($res === false)
		return false;
	$rows = array();
	while ($row = mysqli_fetch_assoc($res))
		$rows[] = $row;
	return $rows;
}

function snapshot($db)
{
	// Nur die für den Ticker nötigen Felder (z. B. kein Passwort)
	$verwaltung = fetchAll($db, 'SELECT Heim, HeimCourt, Gast, GastCourt, Bundesliga, Liga, Spieltag, Datum, Startzeit, Ort FROM Verwaltung WHERE ID = 1');
	$spiele = fetchAll($db, 'SELECT * FROM Spiele ORDER BY Reihenfolge');
	$courts = fetchAll($db, 'SELECT AnzeigeID, Anzeige, Detail, Satz, gewonnenHeim, gewonnenGast, oben, linksheim, linksgast, Aufgabe FROM Courts ORDER BY AnzeigeID');
	if ($verwaltung === false || $spiele === false || $courts === false)
		return false;
	return array(
		'verwaltung' => $verwaltung ? $verwaltung[0] : new stdClass(),
		'spiele' => $spiele,
		'courts' => $courts,
	);
}

function push($cfg, $json)
{
	$ch = curl_init($cfg['url'].'/api/update');
	curl_setopt_array($ch, array(
		CURLOPT_POST => true,
		CURLOPT_POSTFIELDS => $json,
		CURLOPT_HTTPHEADER => array('Content-Type: application/json', 'Authorization: Bearer '.$cfg['token']),
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_CONNECTTIMEOUT => 5,
		CURLOPT_TIMEOUT => 10,
	));
	$body = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	$err = curl_error($ch);
	curl_close($ch);
	if ($code == 200)
		return true;
	if ($code == 401)
		fehler('Ticker-Passwort falsch (im Admin-Panel des Liveticker nachsehen)');
	else
		fehler('Senden an '.$cfg['url'].' fehlgeschlagen: '.($err ?: 'HTTP '.$code.' '.substr($body, 0, 200)));
	return false;
}

$conn = null;
$lastHash = null;
$lastSent = 0;
$lastTarget = null;
$failures = 0;

while (true)
{
	$cfg = settings();
	$aus = ausgeschaltet();
	$snap = null;

	// Neue Adresse oder neues Passwort: sofort komplett senden
	$target = $cfg['url'].'|'.md5($cfg['token']);
	if ($target !== $lastTarget)
	{
		$lastTarget = $target;
		$lastHash = null;
		$failures = 0;
		$status['fehler'] = null;
	}
	// Anderes CourtSpot-Verzeichnis oder andere Datenbank: neu verbinden
	if ($conn !== null)
	{
		$db = dbConfig($cfg);
		if ($cfg['courtspotDir'] !== $conn[2] || !$db || $db['name'] !== $conn[1])
		{
			logMsg('Datenbank gewechselt – verbinde neu');
			@mysqli_close($conn[0]);
			$conn = null;
		}
	}

	if (!$dryRun && ($cfg['url'] === '' || $cfg['token'] === ''))
	{
		$status['fehler'] = 'Noch nicht eingerichtet: im CourtSpot-Menü unter „3. Liveticker“ Adresse und Passwort eintragen';
		statusSchreiben(!$aus, $cfg);
		if ($once)
		{
			fwrite(STDERR, $status['fehler']."\n");
			exit(1);
		}
		sleep(2);
		continue;
	}

	if ($aus)
	{
		// Ausgeschaltet: keine Spieldaten übertragen, DB wird nicht benötigt
		$snap = array('aus' => true, 'verwaltung' => new stdClass(), 'spiele' => array(), 'courts' => array());
	}
	else
	{
		if ($conn === null)
			$conn = connect($cfg);
		if ($conn !== null)
		{
			$snap = snapshot($conn[0]);
			if ($snap === false)
			{
				fehler('Abfrage fehlgeschlagen: '.mysqli_error($conn[0]).' – verbinde neu');
				@mysqli_close($conn[0]);
				$conn = null;
				$snap = null;
			}
		}
	}

	if ($snap !== null)
	{
		$data = json_encode($snap, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
		$hash = md5($data);

		if ($dryRun)
		{
			echo json_encode($snap, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), "\n";
			exit(0);
		}

		if ($hash !== $lastHash || (time() - $lastSent) >= $HEARTBEAT)
		{
			$snap['sentAt'] = gmdate('Y-m-d\TH:i:s\Z');
			$snap['agent'] = array('version' => AGENT_VERSION, 'db' => $conn ? $conn[1] : null);
			if (push($cfg, json_encode($snap, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)))
			{
				if ($failures > 0 || $status['fehler'] !== null)
					logMsg($aus ? 'Liveticker ausgeschaltet gemeldet.' : 'Übertragung zum Liveticker läuft.');
				$status['fehler'] = null;
				$status['letzteUebertragung'] = time();
				$lastHash = $hash;
				$lastSent = time();
				$failures = 0;
			}
			else
			{
				$failures++;
			}
			if ($once)
				exit($failures ? 1 : 0);
		}
	}
	elseif ($once || $dryRun)
	{
		exit(1);
	}

	statusSchreiben(!$aus, $cfg);

	// Bei Fehlern etwas langsamer werden (max. 15 s)
	$wait = $failures ? min(15, $INTERVAL * pow(2, min($failures, 4))) : $INTERVAL;
	if ($snap === null)
		$wait = 5;
	usleep(intval($wait * 1000000));
}
