package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaSyncPolicyTest {
    @Test
    public void regularMediaScanRunsEveryFifteenMinutes() {
        assertEquals(15L * 60L * 1000L, MediaSyncPolicy.INCREMENTAL_INTERVAL_MS);
    }

    @Test
    public void fullReconciliationRunsAtMostOncePerDay() {
        long now = 2L * MediaSyncPolicy.FULL_INTERVAL_MS;
        assertFalse(MediaSyncPolicy.shouldRunFull(now, now - 60_000L));
        assertTrue(MediaSyncPolicy.shouldRunFull(now, now - MediaSyncPolicy.FULL_INTERVAL_MS));
    }

    @Test
    public void retryQueueIsBounded() {
        assertTrue(MediaSyncPolicy.MAX_RETRY_ITEMS > 0);
        assertTrue(MediaSyncPolicy.MAX_RETRY_ITEMS <= 500);
    }
}
