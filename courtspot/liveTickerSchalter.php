<?php
// Liveticker im CourtSpot-Hauptmenü: Status, Ein-/Ausschalten und Einstellungen
// (Adresse und Passwort des CourtSpot Liveticker) für den Push-Dienst
// courtspot-liveticker (/opt/courtspot-liveticker/push.php).
//   GET                               Status
//   POST aktion=an|aus                schalten
//   POST aktion=speichern url, passwort   Einstellungen speichern und testen
//                                     (leeres Passwort = bisheriges behalten)
//   POST aktion=testen [url, passwort] Verbindung testen, ohne zu speichern
//   POST aktion=termin datum, startzeit, ort  Termin der Begegnung (Tabelle Verwaltung)
//                                     selbst eintragen, z. B. nach einem Import ohne Termin
// Das Passwort wird nie an den Browser zurückgegeben.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

$dir = '/var/lib/courtspot-liveticker';
$ausDatei = $dir.'/aus';
$configDatei = $dir.'/config.json';
$fehler = null;
$test = null;

if (!is_dir($dir))
{
	echo json_encode(array('installiert' => false));
	exit();
}

function config()
{
	global $configDatei;
	$c = @json_decode(@file_get_contents($configDatei), true);
	return is_array($c) ? $c : array();
}

// Adresse prüfen und vereinheitlichen (ohne / am Ende, ohne /admin o. Ä.)
function adresse($url)
{
	$url = trim($url);
	if ($url !== '' && !preg_match('#^https?://#i', $url))
		$url = 'http://'.$url;
	$url = preg_replace('#/(admin|courts?|api)(/.*)?$#i', '', rtrim($url, '/'));
	$teile = parse_url($url);
	if (!$teile || empty($teile['host']) || strlen($url) > 300)
		return null;
	return rtrim($url, '/');
}

// Begegnung aus der CourtSpot-Datenbank (dieselbe wie die übrigen CourtSpot-Seiten)
function datenbank()
{
	include __DIR__.'/../../DB_connection.php';
	mysqli_report(MYSQLI_REPORT_OFF);
	$db = @mysqli_connect($DB_adress, $DB_name, $DB_pass, $CS_name, $DB_port);
	if ($db)
		mysqli_set_charset($db, 'utf8');
	return $db ?: null;
}

function begegnung($db)
{
	$res = $db ? mysqli_query($db, 'SELECT Heim, Gast, Datum, Startzeit, Ort FROM Verwaltung WHERE ID = 1') : false;
	$r = $res ? mysqli_fetch_assoc($res) : null;
	if (!$r)
		return null;
	return array(
		'heim' => trim($r['Heim']), 'gast' => trim($r['Gast']),
		'datum' => trim($r['Datum']), 'startzeit' => trim($r['Startzeit']), 'ort' => trim($r['Ort']),
	);
}

// Datum als TT.MM.JJJJ speichern (das Datumsfeld des Browsers liefert JJJJ-MM-TT)
function datumPruefen($d)
{
	$d = trim($d);
	if ($d === '')
		return '';
	if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m))
		$d = $m[3].'.'.$m[2].'.'.$m[1];
	if (!preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/', $d, $m) || !checkdate($m[2], $m[1], $m[3]))
		return null;
	return sprintf('%02d.%02d.%04d', $m[1], $m[2], $m[3]);
}

function zeitPruefen($z)
{
	$z = trim($z);
	if ($z === '')
		return '';
	if (!preg_match('/^(\d{1,2})[:.](\d{2})$/', $z, $m) || $m[1] > 23 || $m[2] > 59)
		return null;
	return sprintf('%02d:%02d', $m[1], $m[2]);
}

// Verbindung prüfen: GET <url>/api/ping mit dem Passwort
function testen($url, $token)
{
	$ch = curl_init($url.'/api/ping');
	curl_setopt_array($ch, array(
		CURLOPT_HTTPHEADER => array('Authorization: Bearer '.$token),
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_CONNECTTIMEOUT => 5,
		CURLOPT_TIMEOUT => 8,
	));
	$body = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	$err = curl_error($ch);
	curl_close($ch);
	$antwort = @json_decode($body, true);
	if ($code == 200 && is_array($antwort) && !empty($antwort['ok']))
		return array('ok' => true, 'text' => 'Verbindung in Ordnung'.(!empty($antwort['title']) ? ' – Liveticker „'.$antwort['title'].'“' : ''));
	if ($code == 401)
		return array('ok' => false, 'text' => 'Adresse stimmt, aber das Passwort ist falsch (steht im Admin-Panel des Liveticker).');
	if ($code == 404)
		return array('ok' => false, 'text' => 'Unter dieser Adresse läuft kein CourtSpot Liveticker (oder eine ältere Version).');
	if ($code == 0)
		return array('ok' => false, 'text' => 'Keine Verbindung: '.($err ?: 'Adresse nicht erreichbar').'. Adresse und Internetverbindung prüfen.');
	return array('ok' => false, 'text' => 'Unerwartete Antwort (HTTP '.$code.').');
}

function speichern($c)
{
	global $configDatei;
	$tmp = $configDatei.'.tmp';
	if (@file_put_contents($tmp, json_encode($c, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) === false)
		return false;
	@chmod($tmp, 0600);
	return @rename($tmp, $configDatei);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST' && isset($_POST['aktion']))
{
	$aktion = $_POST['aktion'];
	if ($aktion == 'an' && file_exists($ausDatei) && !@unlink($ausDatei))
		$fehler = 'Einschalten nicht möglich (Rechte von '.$dir.' prüfen)';
	elseif ($aktion == 'aus' && !file_exists($ausDatei) && !@touch($ausDatei))
		$fehler = 'Ausschalten nicht möglich (Rechte von '.$dir.' prüfen)';
	elseif ($aktion == 'termin')
	{
		$datum = datumPruefen(isset($_POST['datum']) ? $_POST['datum'] : '');
		$zeit = zeitPruefen(isset($_POST['startzeit']) ? $_POST['startzeit'] : '');
		$ort = isset($_POST['ort']) ? trim($_POST['ort']) : '';
		if ($datum === null)
			$fehler = 'Ungültiges Datum (TT.MM.JJJJ).';
		elseif ($zeit === null)
			$fehler = 'Ungültige Uhrzeit (HH:MM).';
		elseif (strlen($ort) > 200)
			$fehler = 'Ort ist zu lang.';
		elseif (!($db = datenbank()))
			$fehler = 'Keine Verbindung zur CourtSpot-Datenbank.';
		else
		{
			// lfdnum+1: CourtSpot-Anzeigen und der Liveticker übernehmen die Änderung sofort
			$stmt = mysqli_prepare($db, 'UPDATE Verwaltung SET Datum = ?, Startzeit = ?, Ort = ?, lfdnum = lfdnum + 1 WHERE ID = 1');
			if (!$stmt || !mysqli_stmt_bind_param($stmt, 'sss', $datum, $zeit, $ort) || !mysqli_stmt_execute($stmt))
				$fehler = 'Termin konnte nicht gespeichert werden: '.mysqli_error($db);
			else
				$terminGespeichert = true;
		}
	}
	elseif ($aktion == 'speichern' || $aktion == 'testen')
	{
		$c = config();
		$url = adresse(isset($_POST['url']) ? $_POST['url'] : '');
		$pw = isset($_POST['passwort']) ? trim($_POST['passwort']) : '';
		if ($pw === '' && !empty($c['token']))
			$pw = $c['token'];
		if ($url === null)
			$fehler = 'Bitte eine gültige Adresse eintragen, z. B. https://live.meinverein.de oder http://192.168.1.50';
		elseif ($pw === '')
			$fehler = 'Bitte das Ticker-Passwort eintragen.';
		elseif (!preg_match('/^[A-Za-z0-9._~-]{6,100}$/', $pw))
			$fehler = 'Das Passwort enthält ungültige Zeichen (erlaubt: Buchstaben ohne Umlaute, Ziffern, - _ . ~).';
		else
		{
			$test = testen($url, $pw);
			if ($aktion == 'speichern')
			{
				$c['url'] = $url;
				$c['token'] = $pw;
				$c['geaendert'] = date('c');
				if (!speichern($c))
					$fehler = 'Speichern nicht möglich (Rechte von '.$dir.' prüfen)';
			}
		}
	}
}

clearstatcache();
$status = @json_decode(@file_get_contents($dir.'/status.json'), true);
if (!is_array($status))
	$status = array();
$feld = function ($k) use ($status) { return isset($status[$k]) ? $status[$k] : null; };
$ts = intval($feld('ts'));
$quelle = $feld('quelle');
$c = config();
$db = isset($db) && $db ? $db : datenbank();
$url = !empty($c['url']) ? $c['url'] : (string) $feld('url');

echo json_encode(array(
	'installiert' => true,
	'aktiv' => !file_exists($ausDatei),
	'eingerichtet' => $url !== '' && (!empty($c['token']) || $quelle === 'datei'),
	'url' => $url,
	'passwortGesetzt' => !empty($c['token']) || $quelle === 'datei',
	'quelle' => $quelle,
	// Der Dienst schreibt den Status jede Sekunde, bei Fehlern spätestens alle 15 s
	'dienstLaeuft' => $ts > 0 && (time() - $ts) < 40,
	'dienstVersion' => $feld('version'),
	'letzteUebertragung' => $feld('letzteUebertragung') ? date('H:i:s', $feld('letzteUebertragung')) : null,
	'dienstFehler' => $feld('fehler'),
	'test' => $test,
	'begegnung' => begegnung($db),
	'terminGespeichert' => !empty($terminGespeichert),
	'fehler' => $fehler,
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
?>
