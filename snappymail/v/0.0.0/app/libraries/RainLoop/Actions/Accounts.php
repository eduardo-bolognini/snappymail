<?php

namespace RainLoop\Actions;

use RainLoop\Enumerations\Capa;
use RainLoop\Exceptions\ClientException;
use RainLoop\Model\Account;
use RainLoop\Model\MainAccount;
use RainLoop\Model\AdditionalAccount;
use RainLoop\Model\Identity;
use RainLoop\Notifications;
use RainLoop\Providers\Identities;
use RainLoop\Providers\Storage\Enumerations\StorageType;
use RainLoop\Utils;
use SnappyMail\IDN;

trait Accounts
{
	private ?\RainLoop\Providers\Identities $oIdentitiesProvider = null;

	protected function GetMainEmail(Account $oAccount)
	{
		return ($oAccount instanceof AdditionalAccount ? $this->getMainAccountFromToken() : $oAccount)->Email();
	}

	public function IdentitiesProvider(): Identities
	{
		if (null === $this->oIdentitiesProvider) {
			$this->oIdentitiesProvider = new Identities($this->fabrica('identities'));
		}

		return $this->oIdentitiesProvider;
	}

	public function GetAccounts(MainAccount $oAccount): array
	{
		if ($this->GetCapa(Capa::ADDITIONAL_ACCOUNTS)) {
			$sAccounts = $this->StorageProvider()->Get($oAccount,
				StorageType::CONFIG,
				'additionalaccounts'
			);
			$aAccounts = $sAccounts ? \json_decode($sAccounts, true)
				: \SnappyMail\Upgrade::ConvertInsecureAccounts($this, $oAccount);
			if ($aAccounts && \is_array($aAccounts)) {
				return $aAccounts;
			}
		}

		return array();
	}

	public function SetAccounts(MainAccount $oAccount, array $aAccounts = array()): void
	{
		$sParentEmail = $oAccount->Email();
		if ($aAccounts) {
			$this->StorageProvider()->Put(
				$oAccount,
				StorageType::CONFIG,
				'additionalaccounts',
				\json_encode($aAccounts)
			);
		} else {
			$this->StorageProvider()->Clear(
				$oAccount,
				StorageType::CONFIG,
				'additionalaccounts'
			);
		}
	}

	/**
	 * Add/Edit additional account
	 * @throws \MailSo\RuntimeException
	 */
	public function DoAccountSetup(): array
	{
		if (!$this->GetCapa(Capa::ADDITIONAL_ACCOUNTS)) {
			return $this->FalseResponse();
		}

		$oMainAccount = $this->getMainAccountFromToken();
		$aAccounts = $this->GetAccounts($oMainAccount);

		$sEmail = \trim($this->GetActionParam('email', ''));
		$oPassword = new \SnappyMail\SensitiveString($this->GetActionParam('password', ''));
		$bNew = !empty($this->GetActionParam('new', 1));

		if ($bNew || \strlen($oPassword)) {
			$oNewAccount = $this->LoginProcess($sEmail, $oPassword, false);
			$sEmail = $oNewAccount->Email();
			$aAccount = $oNewAccount->asTokenArray($oMainAccount);
		} else {
			$aAccount = \RainLoop\Model\AdditionalAccount::convertArray($aAccounts[$sEmail]);
		}

		if ($bNew) {
			if ($oMainAccount->Email() === $sEmail || isset($aAccounts[$sEmail])) {
				throw new ClientException(Notifications::AccountAlreadyExists);
			}
		} else if (!isset($aAccounts[$sEmail])) {
			throw new ClientException(Notifications::AccountDoesNotExist);
		}

		$aAccounts[$sEmail] = $aAccount;

		if ($aAccounts[$sEmail]) {
			$aAccounts[$sEmail]['name'] = \trim($this->GetActionParam('name', ''));
			$this->SetAccounts($oMainAccount, $aAccounts);
		}

		return $this->TrueResponse();
	}

	protected function loadAdditionalAccountImapClient(string $sEmail): \MailSo\Imap\ImapClient
	{
		$sEmail = IDN::emailToAscii($sEmail);
		if (!\strlen($sEmail)) {
			throw new ClientException(Notifications::AccountDoesNotExist);
		}

		$oMainAccount = $this->getMainAccountFromToken();
		$aAccounts = $this->GetAccounts($oMainAccount);
		if (!isset($aAccounts[$sEmail])) {
			throw new ClientException(Notifications::AccountDoesNotExist);
		}
		$oAccount = AdditionalAccount::NewInstanceFromTokenArray($this, $aAccounts[$sEmail]);
		if (!$oAccount) {
			throw new ClientException(Notifications::AccountDoesNotExist);
		}

		$oImapClient = new \MailSo\Imap\ImapClient;
		$oImapClient->SetLogger($this->Logger());
		$this->imapConnect($oAccount, false, $oImapClient);
		return $oImapClient;
	}

	/**
	 * Opens a dedicated mail client for the requested linked account.
	 * It does not change the account selected in the browser session.
	 */
	protected function aiMailClient(string $sEmail): array
	{
		$oMainAccount = $this->getMainAccountFromToken();
		$sEmail = IDN::emailToAscii(\trim($sEmail));
		$oAccount = $oMainAccount;

		if ($sEmail && $sEmail !== $oMainAccount->Email()) {
			$aAccounts = $this->GetAccounts($oMainAccount);
			if (!isset($aAccounts[$sEmail])) {
				throw new ClientException(Notifications::AccountDoesNotExist);
			}
			$oAccount = AdditionalAccount::NewInstanceFromTokenArray($this, $aAccounts[$sEmail]);
			if (!$oAccount) {
				throw new ClientException(Notifications::AccountDoesNotExist);
			}
		}

		$oMailClient = new \MailSo\Mail\MailClient;
		$oMailClient->SetLogger($this->Logger());
		$this->imapConnect($oAccount, false, $oMailClient->ImapClient());
		return [$oAccount, $oMailClient];
	}

	protected function aiFolderNames(\MailSo\Mail\MailClient $oMailClient): array
	{
		$aFolders = array();
		$oCollection = $oMailClient->Folders('', '*', false);
		foreach ($oCollection as $oFolder) {
			if ($oFolder->Selectable()) {
				$aFolders[] = $oFolder->FullName;
			}
		}
		return $aFolders;
	}

	public function DoAiMailboxes(): array
	{
		$oMainAccount = $this->getMainAccountFromToken();
		$aStoredAccounts = $this->GetAccounts($oMainAccount);
		$aAccounts = array(array(
			'email' => $oMainAccount->Email(),
			'name' => '',
			'main' => true
		));
		foreach ($aStoredAccounts as $sEmail => $aStoredAccount) {
			$aAccounts[] = array(
				'email' => $sEmail,
				'name' => (string) ($aStoredAccount['name'] ?? ''),
				'main' => false
			);
		}

		foreach ($aAccounts as &$aAccount) {
			try {
				[$oAccount, $oMailClient] = $this->aiMailClient($aAccount['email']);
				$oFolders = $oMailClient->Folders('', '*', false);
				$aAccount['folders'] = $oFolders->jsonSerialize()['@Collection'];
				$oSettings = $this->SettingsProvider(true)->Load($oAccount);
				$aAccount['systemFolders'] = array(
					'inbox' => 'INBOX',
					'sent' => $oSettings instanceof \RainLoop\Settings ? (string) $oSettings->GetConf('SentFolder', '') : '',
					'drafts' => $oSettings instanceof \RainLoop\Settings ? (string) $oSettings->GetConf('DraftsFolder', '') : '',
					'trash' => $oSettings instanceof \RainLoop\Settings ? (string) $oSettings->GetConf('TrashFolder', '') : '',
					'spam' => $oSettings instanceof \RainLoop\Settings ? (string) $oSettings->GetConf('JunkFolder', '') : ''
				);
			} catch (\Throwable $oException) {
				$aAccount['folders'] = array();
				$aAccount['systemFolders'] = array();
				$aAccount['error'] = $oException->getMessage();
			}
		}
		unset($aAccount);

		return $this->DefaultResponse($aAccounts);
	}

	public function DoAiSearchMessages(): array
	{
		$sAccount = (string) $this->GetActionParam('account', '');
		$sFolder = (string) $this->GetActionParam('folder', '');
		$sSearch = (string) $this->GetActionParam('search', '');
		$iLimit = \min(100, \max(1, (int) $this->GetActionParam('limit', 50)));
		$iOffset = \max(0, (int) $this->GetActionParam('offset', 0));
		[$oAccount, $oMailClient] = $this->aiMailClient($sAccount);
		$aFolders = $sFolder ? array($sFolder) : $this->aiFolderNames($oMailClient);
		$aMessages = array();
		$iTotal = 0;

		foreach ($aFolders as $sFolderName) {
			if (\count($aMessages) >= $iLimit) {
				break;
			}
			try {
				$oParams = new \MailSo\Mail\MessageListParams;
				$oParams->sFolderName = $sFolderName;
				$oParams->iOffset = $sFolder ? $iOffset : 0;
				$oParams->iLimit = $iLimit - \count($aMessages);
				$oParams->sSearch = $sSearch;
				$oParams->sSort = 'REVERSE DATE';
				$oParams->bUseThreads = false;
				$oParams->bUseSort = true;
				$oCollection = $oMailClient->MessageList($oParams);
				$aSerialized = $oCollection->jsonSerialize();
				$iTotal += (int) ($aSerialized['totalEmails'] ?? 0);
				foreach ($aSerialized['@Collection'] ?? array() as $oMessage) {
					$aMessage = $oMessage instanceof \JsonSerializable ? $oMessage->jsonSerialize() : (array) $oMessage;
					$aMessage['account'] = $oAccount->Email();
					$aMessages[] = $aMessage;
				}
			} catch (\Throwable $oException) {
				// A single unavailable folder must not hide results from the other folders.
			}
		}

		\usort($aMessages, static fn ($a, $b) => ($b['dateTimestamp'] ?? 0) <=> ($a['dateTimestamp'] ?? 0));
		$aMessages = \array_slice($aMessages, 0, $iLimit);
		return $this->DefaultResponse(array(
			'account' => $oAccount->Email(),
			'messages' => $aMessages,
			'total' => $iTotal,
			'limited' => $iTotal > \count($aMessages)
		));
	}

	/**
	 * Returns one date-sorted Inbox assembled from every linked account.
	 * Dedicated clients are used so the browser session keeps its selected account.
	 */
	public function DoUnifiedInbox(): array
	{
		$oMainAccount = $this->getMainAccountFromToken();
		$aEmails = array($oMainAccount->Email());
		foreach ($this->GetAccounts($oMainAccount) as $sEmail => $aAccount) {
			$aEmails[] = $sEmail;
		}

		$iOffset = \max(0, (int) $this->GetActionParam('offset', 0));
		$iLimit = \min(100, \max(1, (int) $this->GetActionParam('limit', 20)));
		$sSearch = (string) $this->GetActionParam('search', '');
		$iFetchLimit = $iOffset + $iLimit;
		$aMessages = array();
		$aFailedAccounts = array();
		$iTotal = 0;

		foreach ($aEmails as $sEmail) {
			try {
				[$oAccount, $oMailClient] = $this->aiMailClient($sEmail);
				$oParams = new \MailSo\Mail\MessageListParams;
				$oParams->sFolderName = 'INBOX';
				$oParams->iOffset = 0;
				$oParams->iLimit = $iFetchLimit;
				$oParams->sSearch = $sSearch;
				$oParams->sSort = 'REVERSE DATE';
				$oParams->bUseThreads = false;
				$oParams->bUseSort = true;
				$aSerialized = $oMailClient->MessageList($oParams)->jsonSerialize();
				$iTotal += (int) ($aSerialized['totalEmails'] ?? 0);

				foreach ($aSerialized['@Collection'] ?? array() as $oMessage) {
					$aMessage = $oMessage instanceof \JsonSerializable ? $oMessage->jsonSerialize() : (array) $oMessage;
					$aMessage['account'] = $oAccount->Email();
					$aMessages[] = $aMessage;
				}
			} catch (\Throwable $oException) {
				$aFailedAccounts[] = $sEmail;
			}
		}

		\usort($aMessages, static fn ($a, $b) => ($b['dateTimestamp'] ?? 0) <=> ($a['dateTimestamp'] ?? 0));
		$aMessages = \array_slice($aMessages, $iOffset, $iLimit);

		return $this->DefaultResponse(array(
			'@Object' => 'Collection/MessageCollection',
			'@Collection' => $aMessages,
			'folder' => array(
				'name' => 'INBOX',
				'totalEmails' => $iTotal
			),
			'totalEmails' => $iTotal,
			'offset' => $iOffset,
			'limit' => $iLimit,
			'search' => $sSearch,
			'limited' => $iOffset + \count($aMessages) < $iTotal,
			'threadUid' => 0,
			'newMessages' => array(),
			'failedAccounts' => $aFailedAccounts
		));
	}

	public function DoAiGetMessage(): array
	{
		$sAccount = (string) $this->GetActionParam('account', '');
		$sFolder = (string) $this->GetActionParam('folder', '');
		$iUid = (int) $this->GetActionParam('uid', 0);
		if (!$sFolder || $iUid < 1) {
			throw new ClientException(Notifications::CantGetMessage);
		}

		[$oAccount, $oMailClient] = $this->aiMailClient($sAccount);
		$oMessage = $oMailClient->Message($sFolder, $iUid, true);
		if (!$oMessage) {
			throw new ClientException(Notifications::CantGetMessage);
		}
		$aMessage = $oMessage->jsonSerialize();
		$aMessage['account'] = $oAccount->Email();
		return $this->DefaultResponse($aMessage);
	}

	public function DoAccountUnread(): array
	{
		$oImapClient = $this->loadAdditionalAccountImapClient($this->GetActionParam('email', ''));
		$oInfo = $oImapClient->FolderStatus('INBOX');
		return $this->DefaultResponse([
			'unreadEmails' => \max(0, $oInfo->UNSEEN)
		]);
	}

	/**
	 * Imports all mail from AdditionalAccount into MainAccount
	 */
	public function DoAccountImport(): array
	{
		$sEmail = $this->GetActionParam('email', '');
		$oImapSource = $this->loadAdditionalAccountImapClient($sEmail);

		$oMainAccount = $this->getMainAccountFromToken();
		$oImapTarget = new \MailSo\Imap\ImapClient;
		$oImapTarget->SetLogger($this->Logger());
		$this->imapConnect($oMainAccount, false, $oImapTarget);

		$oSync = new \SnappyMail\Imap\Sync;
		$oSync->oImapSource = $oImapSource;
		$oSync->oImapTarget = $oImapTarget;

		$rootfolder = $this->GetActionParam('rootfolder', '') ?: $sEmail;
		$oSync->import($rootfolder);
		exit;
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoAccountDelete(): array
	{
		$oMainAccount = $this->getMainAccountFromToken();

		if (!$this->GetCapa(Capa::ADDITIONAL_ACCOUNTS)) {
			return $this->FalseResponse();
		}

		$sEmailToDelete = \trim($this->GetActionParam('emailToDelete', ''));
		$sEmailToDelete = IDN::emailToAscii($sEmailToDelete);

		$aAccounts = $this->GetAccounts($oMainAccount);

		if (\strlen($sEmailToDelete) && isset($aAccounts[$sEmailToDelete])) {
			$bReload = false;
			$oAccount = $this->getAccountFromToken();
			if ($oAccount instanceof AdditionalAccount && $oAccount->Email() === $sEmailToDelete) {
//				$this->SetAdditionalAuthToken(null);
				\SnappyMail\Cookies::clear(self::AUTH_ADDITIONAL_TOKEN_KEY);
				$bReload = true;
			}

			unset($aAccounts[$sEmailToDelete]);
			$this->SetAccounts($oMainAccount, $aAccounts);

			return $this->TrueResponse(array('Reload' => $bReload));
		}

		return $this->FalseResponse();
	}

	public function getAccountData(Account $oAccount): array
	{
		$oConfig = $this->Config();
		$minRefreshInterval = (int) $oConfig->Get('webmail', 'min_refresh_interval', 5);
		$aResult = [
//			'Email' => IDN::emailToUtf8($oAccount->Email()),
			'Email' => $oAccount->Email(),
			'accountHash' => $oAccount->Hash(),
			'mainEmail' => \RainLoop\Api::Actions()->getMainAccountFromToken()->Email(),
			'contactsAllowed' => $this->AddressBookProvider($oAccount)->IsActive(),
			'HideUnsubscribed' => false,
			'defaultSort' => '',
			'useThreads' => (bool) $oConfig->Get('defaults', 'mail_use_threads', false),
			'threadAlgorithm' => '',
			'ReplySameFolder' => (bool) $oConfig->Get('defaults', 'mail_reply_same_folder', false),
			'HideDeleted' => true,
			'ShowUnreadCount' => false,
			'UnhideKolabFolders' => false,
			'CheckMailInterval' => \max(15, $minRefreshInterval)
		];
		$oSettingsLocal = $this->SettingsProvider(true)->Load($oAccount);
		if ($oSettingsLocal instanceof \RainLoop\Settings) {
			$aResult['SentFolder'] = (string) $oSettingsLocal->GetConf('SentFolder', '');
			$aResult['DraftsFolder'] = (string) $oSettingsLocal->GetConf('DraftsFolder', '');
			$aResult['JunkFolder'] = (string) $oSettingsLocal->GetConf('JunkFolder', '');
			$aResult['TrashFolder'] = (string) $oSettingsLocal->GetConf('TrashFolder', '');
			$aResult['ArchiveFolder'] = (string) $oSettingsLocal->GetConf('ArchiveFolder', '');
			$aResult['HideUnsubscribed'] = (bool) $oSettingsLocal->GetConf('HideUnsubscribed', $aResult['HideUnsubscribed']);
			$aResult['defaultSort'] = (string) $oSettingsLocal->GetConf('defaultSort', $aResult['defaultSort']);
			$aResult['useThreads'] = (bool) $oSettingsLocal->GetConf('UseThreads', $aResult['useThreads']);
			$aResult['threadAlgorithm'] = (string) $oSettingsLocal->GetConf('threadAlgorithm', $aResult['threadAlgorithm']);
			$aResult['ReplySameFolder'] = (bool) $oSettingsLocal->GetConf('ReplySameFolder', $aResult['ReplySameFolder']);
			$aResult['HideDeleted'] = (bool)$oSettingsLocal->GetConf('HideDeleted', $aResult['HideDeleted']);
			$aResult['ShowUnreadCount'] = (bool)$oSettingsLocal->GetConf('ShowUnreadCount', $aResult['ShowUnreadCount']);
			$aResult['UnhideKolabFolders'] = (bool)$oSettingsLocal->GetConf('UnhideKolabFolders', $aResult['UnhideKolabFolders']);
			$aResult['CheckMailInterval'] = \max((int) $oSettingsLocal->GetConf('CheckMailInterval', $aResult['CheckMailInterval']), $minRefreshInterval);
/*
			foreach ($oSettingsLocal->toArray() as $key => $value) {
				$aResult[\lcfirst($key)] = $value;
			}
			$aResult['junkFolder'] = $aResult['spamFolder'];
			unset($aResult['checkableFolder']);
			unset($aResult['theme']);
*/
		}
		return $aResult;
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoAccountSwitch(): array
	{
		if ($this->switchAccount(\trim($this->GetActionParam('Email', '')))) {
			$oAccount = $this->getAccountFromToken();
			$aResult = $this->getAccountData($oAccount);
//			$this->Plugins()->InitAppData($bAdmin, $aResult, $oAccount);
			return $this->DefaultResponse($aResult);
		}
		return $this->FalseResponse();
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoIdentityUpdate(): array
	{
		$oAccount = $this->getAccountFromToken();

		$oIdentity = new Identity();
		if (!$oIdentity->FromJSON($this->GetActionParams(), true)) {
			throw new ClientException(Notifications::InvalidInputArgument);
		}
/*		// TODO: verify private key for certificate?
		if ($oIdentity->smimeCertificate && $oIdentity->smimeKey) {
			new \SnappyMail\SMime\Certificate($oIdentity->smimeCertificate, $oIdentity->smimeKey);
		}
*/
		$this->IdentitiesProvider()->UpdateIdentity($oAccount, $oIdentity);
		return $this->TrueResponse();
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoIdentityDelete(): array
	{
		$oAccount = $this->getAccountFromToken();

		if (!$this->GetCapa(Capa::IDENTITIES)) {
			return $this->FalseResponse();
		}

		$sId = \trim($this->GetActionParam('idToDelete', ''));
		if (empty($sId)) {
			throw new ClientException(Notifications::UnknownError);
		}

		$this->IdentitiesProvider()->DeleteIdentity($oAccount, $sId);
		return $this->TrueResponse();
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoAccountsAndIdentitiesSortOrder(): array
	{
		$aAccounts = $this->GetActionParam('Accounts', null);
		$aIdentities = $this->GetActionParam('Identities', null);

		if (!\is_array($aAccounts) && !\is_array($aIdentities)) {
			return $this->FalseResponse();
		}

		if (\is_array($aAccounts) && 1 < \count($aAccounts)) {
			$oAccount = $this->getMainAccountFromToken();
			$aAccounts = \array_filter(\array_merge(
				\array_fill_keys($aAccounts, null),
				$this->GetAccounts($oAccount)
			));
			$this->SetAccounts($oAccount, $aAccounts);
		}

		return $this->DefaultResponse($this->LocalStorageProvider()->Put(
			$this->getAccountFromToken(),
			StorageType::CONFIG,
			'identities_order',
			\json_encode(array(
				'Identities' => \is_array($aIdentities) ? $aIdentities : array()
			))
		));
	}

	/**
	 * @throws \MailSo\RuntimeException
	 */
	public function DoAccountsAndIdentities(): array
	{
		$oMainAccount = $this->getMainAccountFromToken();
		$oCurrentAccount = $this->getAccountFromToken();
		$aStoredAccounts = $this->GetAccounts($oMainAccount);
		$aSenderIdentities = array();
		$aSenderAccounts = array($oMainAccount->Email() => $oMainAccount);

		foreach ($aStoredAccounts as $sEmail => $aStoredAccount) {
			$oAdditionalAccount = AdditionalAccount::NewInstanceFromTokenArray($this, $aStoredAccount);
			if ($oAdditionalAccount) {
				$aSenderAccounts[$oAdditionalAccount->Email()] = $oAdditionalAccount;
			}
		}

		foreach ($aSenderAccounts as $sAccountEmail => $oSenderAccount) {
			$oSettings = $this->SettingsProvider(true)->Load($oSenderAccount);
			$sSentFolder = $oSettings instanceof \RainLoop\Settings
				? (string) $oSettings->GetConf('SentFolder', '')
				: '';
			foreach ($this->GetIdentities($oSenderAccount) as $oIdentity) {
				$aIdentity = $oIdentity->jsonSerialize();
				$aIdentity['accountEmail'] = IDN::emailToUtf8($sAccountEmail);
				$aIdentity['accountName'] = (string) ($aStoredAccounts[$sAccountEmail]['name'] ?? '');
				if (empty($aIdentity['sentFolder'])) {
					$aIdentity['sentFolder'] = $sSentFolder;
				}
				$aSenderIdentities[] = $aIdentity;
			}
		}

		// https://github.com/the-djmaze/snappymail/issues/571
		return $this->DefaultResponse(array(
			'Accounts' => \array_values(\array_map(function($value){
					return [
						'email' => IDN::emailToUtf8($value['email'] ?? $value[1]),
						'name' => $value['name'] ?? ''
					];
				},
				$aStoredAccounts
			)),
			'Identities' => $this->GetIdentities($oCurrentAccount),
			'SenderIdentities' => $aSenderIdentities
		));
	}

	/**
	 * @return Identity[]
	 */
	public function GetIdentities(Account $oAccount): array
	{
		// A custom name for a single identity is also stored in this system
		$allowMultipleIdentities = $this->GetCapa(Capa::IDENTITIES);

		// Get all identities
		$identities = $this->IdentitiesProvider()->GetIdentities($oAccount, $allowMultipleIdentities);

		// Sort identities
		$orderString = $this->LocalStorageProvider()->Get($oAccount, StorageType::CONFIG, 'identities_order');
		$old = false;
		if (!$orderString) {
			$orderString = $this->StorageProvider()->Get($oAccount, StorageType::CONFIG, 'accounts_identities_order');
			$old = !!$orderString;
		}

		$order = \json_decode($orderString, true) ?? [];
		if (isset($order['Identities']) && \is_array($order['Identities']) && 1 < \count($order['Identities'])) {
			$list = \array_map(function ($item) {
				return ('' === $item) ? '---' : $item;
			}, $order['Identities']);

			\usort($identities, function ($a, $b) use ($list) {
				return \array_search($a->Id(true), $list) < \array_search($b->Id(true), $list) ? -1 : 1;
			});
		}

		if ($old) {
			$this->LocalStorageProvider()->Put(
				$oAccount,
				StorageType::CONFIG,
				'identities_order',
				\json_encode(array('Identities' => empty($order['Identities']) ? [] : $order['Identities']))
			);
			$this->StorageProvider()->Clear($oAccount, StorageType::CONFIG, 'accounts_identities_order');
		}

		return $identities;
	}

	public function GetIdentityByID(Account $oAccount, string $sID, bool $bFirstOnEmpty = false): ?Identity
	{
		$aIdentities = $this->GetIdentities($oAccount);

		foreach ($aIdentities as $oIdentity) {
			if ($oIdentity && $sID === $oIdentity->Id()) {
				return $oIdentity;
			}
		}

		return $bFirstOnEmpty && isset($aIdentities[0]) ? $aIdentities[0] : null;
	}

}
