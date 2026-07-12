package com.nexus.app;

public final class ReliabilityPolicy {
    private ReliabilityPolicy() {}

    public static final long RECOVERY_INTERVAL_MS = 15L * 60L * 1000L;
    public static final boolean COMMAND_ACK_REQUIRED = true;
    public static final boolean ADVANCE_CURSOR_ON_CONFIRMED_SUCCESS_ONLY = true;
}
