package com.nexus.app;

import java.util.HashSet;
import java.util.Set;

/** Tracks only confirmed uploads. Failed/skipped items remain eligible. */
public class MediaSyncLedger {
    private final Set<String> completed = new HashSet<>();

    public static String key(String kind, long mediaId, long modifiedSeconds, long size) {
        return kind + ":" + mediaId + ":" + modifiedSeconds + ":" + size;
    }

    public boolean shouldUpload(String key) {
        return !completed.contains(key);
    }

    public void markSuccess(String key) {
        completed.add(key);
    }

    public void markFailed(String key) {
        // Intentionally do not persist failures: retry on the next full scan.
    }
}
