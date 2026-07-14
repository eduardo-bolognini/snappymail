<?php

if ($argc < 2) {
	fwrite(STDERR, "Usage: lint-php.php <file>...\n");
	exit(2);
}

$failed = false;
foreach (array_slice($argv, 1) as $file) {
	try {
		$source = file_get_contents($file);
		if ($source === false) {
			throw new RuntimeException('Unable to read file');
		}
		token_get_all($source, TOKEN_PARSE);
		echo "No syntax errors detected in {$file}\n";
	} catch (Throwable $error) {
		fwrite(STDERR, "{$file}: {$error->getMessage()}\n");
		$failed = true;
	}
}

exit($failed ? 1 : 0);
