<?php

$desktopDataPath = getenv('SNAPPYMAIL_DESKTOP_DATA');
if (!$desktopDataPath) {
	throw new RuntimeException('SNAPPYMAIL_DESKTOP_DATA is not configured');
}

define('APP_DATA_FOLDER_PATH', rtrim($desktopDataPath, '/\\') . DIRECTORY_SEPARATOR);
