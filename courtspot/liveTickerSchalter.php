<?php
// Liveticker im CourtSpot-Hauptmenü: Status, Ein-/Ausschalten und Einstellungen
// (Adresse und Passwort des CourtSpot Liveticker) für den Push-Dienst
// courtspot-liveticker (/opt/courtspot-liveticker/push.php).
//   GET                               Status
//   POST aktion=an|aus                schalten
//   POST aktion=speichern url, passwort   Einstellungen speichern und testen
//                                     (leeres Passwort = bisheriges behalten)
//   POST aktion=testen [url, passwort] Verbindung testen, ohne zu speichern
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
	'fehler' => $fehler,
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
?>
