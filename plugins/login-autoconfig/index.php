<?php
/**
 * https://datatracker.ietf.org/doc/draft-bucksch-autoconfig/
 */

class LoginAutoconfigPlugin extends \RainLoop\Plugins\AbstractPlugin
{
	const
		NAME     = 'Login Autoconfig',
		AUTHOR   = 'SnappyMail',
		URL      = 'https://snappymail.eu/',
		VERSION  = '1.3',
		RELEASE  = '2026-07-13',
		REQUIRED = '2.35.3',
		CATEGORY = 'Login',
		LICENSE  = 'MIT',
		DESCRIPTION = 'Loads saved domains and accepts manual desktop mail server settings';

	public function Init() : void
	{
		$this->addHook('login.credentials.step-1', 'detect');
	}

	public function detect(string $sEmail) : void
	{
		if (\str_contains($sEmail, '@')) {
			$oProvider = $this->Manager()->Actions()->DomainProvider();
			$sDomain = \MailSo\Base\Utils::getEmailAddressDomain($sEmail);
			$this->saveManualDomain($sDomain, $oProvider);
		}
	}

	private function saveManualDomain(string $domain, $provider) : ?\RainLoop\Model\Domain
	{
		$actions = $this->Manager()->Actions();
		if ('1' !== (string) $actions->GetActionParam('DesktopManualConfig', '0')) {
			return null;
		}

		$imapHost = $this->validHost((string) $actions->GetActionParam('DesktopImapHost', ''));
		$smtpHost = $this->validHost((string) $actions->GetActionParam('DesktopSmtpHost', ''));
		$imapPort = $this->validPort($actions->GetActionParam('DesktopImapPort', 0));
		$smtpPort = $this->validPort($actions->GetActionParam('DesktopSmtpPort', 0));
		$imapType = (int) $actions->GetActionParam('DesktopImapType', 1);
		$smtpType = (int) $actions->GetActionParam('DesktopSmtpType', 1);

		if (!$imapHost || !$smtpHost || !$imapPort || !$smtpPort
			|| !\in_array($imapType, [0, 1, 2], true)
			|| !\in_array($smtpType, [0, 1, 2], true)
		) {
			return null;
		}

		$domainConfig = \RainLoop\Model\Domain::fromArray($domain, [
			'IMAP' => [
				'host' => $imapHost,
				'port' => $imapPort,
				'type' => $imapType,
				'timeout' => 30,
				'shortLogin' => false,
				'lowerLogin' => true,
				'ssl' => []
			],
			'SMTP' => [
				'host' => $smtpHost,
				'port' => $smtpPort,
				'type' => $smtpType,
				'timeout' => 30,
				'shortLogin' => false,
				'lowerLogin' => true,
				'ssl' => [],
				'useAuth' => true,
				'setSender' => false,
				'usePhpMail' => false
			],
			'Sieve' => [
				'host' => $imapHost,
				'port' => 4190,
				'type' => 0,
				'timeout' => 10,
				'shortLogin' => false,
				'lowerLogin' => true,
				'ssl' => [],
				'enabled' => false
			],
			'whiteList' => ''
		]);

		if ($domainConfig && $provider->Save($domainConfig)) {
			return $provider->Load($domain, false);
		}
		return null;
	}

	private function validHost(string $host) : string
	{
		$host = \rtrim(\trim($host), '.');
		if (\filter_var($host, \FILTER_VALIDATE_IP)) {
			return $host;
		}
		$host = \strtolower((string) \idn_to_ascii($host));
		if (!$host || \strlen($host) > 253 || \str_contains($host, '..')) {
			return '';
		}
		foreach (\explode('.', $host) as $label) {
			if (!\preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/D', $label)) {
				return '';
			}
		}
		return $host;
	}

	private function validPort($port) : int
	{
		$port = (int) $port;
		return 0 < $port && 65536 > $port ? $port : 0;
	}

}
