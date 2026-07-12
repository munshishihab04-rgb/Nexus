package com.nexus.app;

public final class RuntimeSyncPolicy {
    private RuntimeSyncPolicy() {}

    public static final boolean COMMANDS_VIA_HEARTBEAT = true;
    public static final long GPS_INTERVAL_MS = 5L * 60L * 1000L;
    public static final float MIN_LOCATION_DISTANCE_METERS = 50f;
    public static final long MAX_LOCATION_SILENCE_MS = 30L * 60L * 1000L;
}
