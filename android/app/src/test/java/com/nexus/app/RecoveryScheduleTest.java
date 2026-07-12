package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RecoveryScheduleTest {
    @Test
    public void recoveryJobIsPersistedAndNetworkConstrained() {
        assertTrue(RecoverySchedule.PERSISTED);
        assertTrue(RecoverySchedule.REQUIRES_NETWORK);
        assertTrue(RecoverySchedule.PERIOD_MS >= 15L * 60L * 1000L);
    }
}
