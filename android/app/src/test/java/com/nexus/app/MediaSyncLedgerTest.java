package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaSyncLedgerTest {
    @Test
    public void failedItemRemainsEligibleForNextSync() {
        MediaSyncLedger ledger = new MediaSyncLedger();
        String key = MediaSyncLedger.key("image", 42L, 1000L, 500L);
        assertTrue(ledger.shouldUpload(key));
        ledger.markFailed(key);
        assertTrue(ledger.shouldUpload(key));
    }

    @Test
    public void successfulItemIsSkippedUntilItsMetadataChanges() {
        MediaSyncLedger ledger = new MediaSyncLedger();
        String original = MediaSyncLedger.key("image", 42L, 1000L, 500L);
        ledger.markSuccess(original);
        assertFalse(ledger.shouldUpload(original));

        String modified = MediaSyncLedger.key("image", 42L, 2000L, 700L);
        assertTrue(ledger.shouldUpload(modified));
    }
}
