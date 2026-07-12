package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RuntimeSyncPolicyTest {
    @Test
    public void commandPollingIsCoveredByHeartbeat() {
        assertTrue(RuntimeSyncPolicy.COMMANDS_VIA_HEARTBEAT);
    }

    @Test
    public void unchangedLocationIsNotSentEveryThirtySeconds() {
        assertTrue(RuntimeSyncPolicy.GPS_INTERVAL_MS >= 2L * 60L * 1000L);
        assertTrue(RuntimeSyncPolicy.MIN_LOCATION_DISTANCE_METERS >= 25f);
    }
}
