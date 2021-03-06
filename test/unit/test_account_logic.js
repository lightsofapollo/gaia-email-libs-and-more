/**
 * Account logic that currently needs to be its own file because IndexedDB
 * db reuse makes this test unhappy.
 **/

load('resources/loggest_test_framework.js');

var TD = $tc.defineTestsFor(
  { id: 'test_account_logic' }, null, [$th_imap.TESTHELPER], ['app']);

/**
 * Test that we can add and remove accounts and that the view-slices properly
 * update and that database rows get nuked appropriately.
 *
 * For simplicity, we currently create duplicate accounts.  This obviously will
 * not work once we prevent creating duplicate accounts.
 */
TD.commonCase('account creation/deletion', function(T) {
  T.group('create universe, first account');
  var testUniverse = T.actor('testUniverse', 'U',
                             { name: 'A' }),
      testAccountA = T.actor('testAccount', 'A',
                             { universe: testUniverse }),
      eSliceCheck = T.lazyLogger('sliceCheck');
  var folderPointAB = null, folderPointBC = null, folderPointC = null;
  T.action('snapshot number of folders', function() {
    folderPointAB = gAllFoldersSlice.items.length;
  });


  T.group('create second account');
  var testAccountB = T.actor('testAccount', 'B',
                             { universe: testUniverse, name: 'B' });
  T.check(eSliceCheck, 'account and folders listed', function() {
    // the account should be after the known account
    eSliceCheck.expect_namedValue('accounts[1].id', testAccountB.accountId);
    eSliceCheck.namedValue('accounts[1].id', gAllAccountsSlice.items[1].id);

    // There should be some folders (don't know how many; it's probably a
    // realish account), located after all previously known folders.

    eSliceCheck.expect_event('folders present');
    folderPointBC = gAllFoldersSlice.items.length;
    var bFoldersObserved = 0;
    if (gAllFoldersSlice.items[folderPointAB].type !== 'account')
      throw new Error('Account folder not created!');
    for (var i = folderPointAB; i < gAllFoldersSlice.items.length; i++) {
      var folder = gAllFoldersSlice.items[i];
      if (folder.id[0] === testAccountB.accountId)
        bFoldersObserved++;
      else
        break;
    }
    if (bFoldersObserved !== folderPointBC - folderPointAB)
      throw new Error("Invariant problemo; did not scan all folders; " +
                      bFoldersObserved + ' observed, ' +
                      (folderPointBC - folderPointAB) + ' expected');
    eSliceCheck.event('folders present');
  });

  T.group('create third account');
  var testAccountC = T.actor('testAccount', 'C',
                             { universe: testUniverse });
  T.check(eSliceCheck, 'account and folders listed', function() {
    // the account should be after the known account
    eSliceCheck.expect_namedValue('accounts[1].id', testAccountB.accountId);
    eSliceCheck.namedValue('accounts[1].id', gAllAccountsSlice.items[1].id);

    // There should be some folders (don't know how many; it's probably a
    // realish account), located after all previously known folders.

    eSliceCheck.expect_event('folders present');
    folderPointC = gAllFoldersSlice.items.length;
    var cFoldersObserved = 0;
    if (gAllFoldersSlice.items[folderPointBC].type !== 'account')
      throw new Error('Account folder not created!');
    for (var i = folderPointBC; i < gAllFoldersSlice.items.length; i++) {
      var folder = gAllFoldersSlice.items[i];
      if (folder.id[0] === testAccountC.accountId)
        cFoldersObserved++;
      else
        break;
    }
    if (cFoldersObserved !== folderPointC - folderPointBC)
      throw new Error("Invariant problemo; did not scan all folders; " +
                      bFoldersObserved + ' observed, ' +
                      (folderPointC - folderPointBC) + ' expected');
    eSliceCheck.event('folders present');
  });

  T.group('delete second (middle) account');
  T.action('delete account', testAccountB, 'perform', eSliceCheck,
           testAccountB.eOpAccount, function() {
    if (TEST_PARAMS.type === 'imap')
      testAccountB.eImapAccount.expect_deadConnection();

    eSliceCheck.expect_namedValue('remaining account', testAccountA.accountId);
    eSliceCheck.expect_namedValue('remaining account', testAccountC.accountId);

    var expectedFolders = folderPointC - (folderPointBC - folderPointAB);
    eSliceCheck.expect_namedValue('num folders', expectedFolders);
    eSliceCheck.expect_namedValue('folder[AB-1].account',
                                  testAccountA.accountId);
    eSliceCheck.expect_namedValue('folder[AB].account',
                                  testAccountC.accountId);
    testAccountB.eOpAccount.expect_accountDeleted('saveAccountState');

    // this does not have a callback, so use a ping to wait...
    gAllAccountsSlice.items[1].deleteAccount();
    MailAPI.ping(function() {
      var i;
      for (i = 0; i < gAllAccountsSlice.items.length; i++) {
        eSliceCheck.namedValue('remaining account',
                               gAllAccountsSlice.items[i].id);
      }

      eSliceCheck.namedValue('num folders', gAllFoldersSlice.items.length);
      eSliceCheck.namedValue(
        'folder[AB-1].account',
        gAllFoldersSlice.items[folderPointAB-1].id[0]);
      eSliceCheck.namedValue(
        'folder[AB].account',
        gAllFoldersSlice.items[folderPointAB].id[0]);

      testAccountB.account.saveAccountState();
    });
  });

  T.action(testUniverse, 'check database does not contain', function() {
    testUniverse.help_checkDatabaseDoesNotContain([
      { table: 'config', prefix: 'accountDef:' + testAccountB.accountId },
      { table: 'folderInfo', prefix: testAccountB.accountId },
      { table: 'headerBlocks', prefix: testAccountB.accountId + '/' },
      { table: 'bodyBlocks', prefix: testAccountB.accountId + '/' },
    ]);
  });

  T.group('cleanup');
});

/**
 * Make sure we don't get duplicate folders from running syncFolderList a
 * second time.  Our account list should be up-to-date at this time, so
 * running it a second time should not result in a change in the number of
 * folders.  We also want to rule out the existing folders being removed and
 * then replaced with effectively identical ones, so we listen for splice
 * notifications.
 */
TD.commonCase('syncFolderList is idempotent', function(T) {
  T.group('setup');
  var testUniverse = T.actor('testUniverse', 'U'),
      testAccount = T.actor('testAccount', 'A',
                            { universe: testUniverse, restored: true }),
      eSync = T.lazyLogger('sync');

  T.group('syncFolderList and check');
  var numFolders, numAdds = 0, numDeletes = 0;
  T.action('run syncFolderList', eSync, function(T) {
    numFolders = testUniverse.allFoldersSlice.items.length;
    testUniverse.allFoldersSlice.onsplice = function(index, delCount,
                                                     addedItems) {
      numAdds += addedItems.length;
      numDeletes += delCount;
    };

    testAccount.expect_runOp('syncFolderList',
                             { local: false, server: true, conn: true });
    eSync.expect_event('roundtripped');
    testUniverse.universe.syncFolderList(testAccount.account, function() {
      testUniverse.MailAPI.ping(function() {
        eSync.event('roundtripped');
      });
    });
  });
  T.check('check folder list', eSync, function(T) {
    eSync.expect_namedValue('num folders', numFolders);
    eSync.expect_namedValue('num added', numAdds);
    eSync.expect_namedValue('num deleted', numDeletes);
    eSync.namedValue('num folders', testUniverse.allFoldersSlice.items.length);
    eSync.namedValue('num added', numAdds);
    eSync.namedValue('num deleted', numDeletes);
  });

  T.group('cleanup');
});

TD.commonCase('syncFolderList obeys hierarchy', function(T) {
  T.group('setup');
  var testUniverse = T.actor('testUniverse', 'U'),
      testServer = T.actor('testActiveSyncServer', 'S',
                           { universe: testUniverse }),
      eSync = T.lazyLogger('sync');

  if (TEST_PARAMS.type === 'activesync') {
    T.action('create test folders', function() {
      const folderType = $_ascp.FolderHierarchy.Enums.Type;
      var inbox = testServer.server.foldersByType['inbox'][0],
          sent  = testServer.server.foldersByType['sent'][0],
          trash = testServer.server.foldersByType['trash'][0];

      var subinbox = testServer.server.addFolder(
        'Subinbox', folderType.Mail, inbox);
      testServer.server.addFolder(
        'Subsubinbox', folderType.Inbox, subinbox);

      var subsent = testServer.server.addFolder(
        'Subsent', folderType.Mail, sent);
      testServer.server.addFolder(
        'Subsubsent', folderType.Inbox, subsent);

      var subtrash = testServer.server.addFolder(
        'Subtrash', folderType.Mail, trash);
      testServer.server.addFolder(
        'Subsubtrash', folderType.Inbox, subtrash);

      var folder = testServer.server.addFolder(
        'Folder', folderType.Mail);
      testServer.server.addFolder(
        'Subfolder', folderType.Inbox, folder);
    });
  }

  var testAccount = T.actor('testAccount', 'A',
                            { universe: testUniverse,
                              server: testServer});

  T.group('check folder list');
  T.check('check folder list', testAccount, eSync, function(T) {
    var myFolderExp = new RegExp('^' + testAccount.accountId + '/');
    var folders = testUniverse.allFoldersSlice.items.filter(function(x) {
      return myFolderExp.test(x.id);
    });

    var hierarchy = [];
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].depth < hierarchy.length)
        hierarchy.length = folders[i].depth;
      if (folders[i].depth === hierarchy.length)
        hierarchy.push(folders[i].name);

      eSync.expect_namedValue('path', folders[i].path);
      eSync.namedValue('path', hierarchy.join('/'));
    }
  });

  T.group('cleanup');
});

function run_test() {
  runMyTests(5);
}
