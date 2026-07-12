package com.nexus.app;

public final class MediaSyncPolicy {
    private MediaSyncPolicy() {}

    public static final long INCREMENTAL_INTERVAL_MS = 15L * 60L * 1000L;
    public static final long FULL_INTERVAL_MS = 24L * 60L * 60L * 1000L;
    public static final int MAX_RETRY_ITEMS = 300;

    public static boolean shouldRunFull(long now, long lastFull) {
        return lastFull <= 0 || now - lastFull >= FULL_INTERVAL_MS;
    }
}
