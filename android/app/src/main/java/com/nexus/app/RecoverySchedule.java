package com.nexus.app;

public final class RecoverySchedule {
    private RecoverySchedule() {}

    public static final boolean PERSISTED = true;
    public static final boolean REQUIRES_NETWORK = true;
    public static final long PERIOD_MS = 15L * 60L * 1000L;
}
