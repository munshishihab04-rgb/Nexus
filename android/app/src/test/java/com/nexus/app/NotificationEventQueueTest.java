package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationEventQueueTest {
    @Test public void stableIdChangesWithMessageIdentity() {
        String a = NotificationEventQueue.idFor("com.whatsapp", "Gruppo", "Mario", "Ciao", 1000L);
        String b = NotificationEventQueue.idFor("com.whatsapp", "Gruppo", "Mario", "Ciao", 1000L);
        String c = NotificationEventQueue.idFor("com.whatsapp", "Gruppo", "Mario", "Altro", 1000L);
        assertEquals(a, b);
        assertNotEquals(a, c);
        assertEquals(64, a.length());
    }
}
