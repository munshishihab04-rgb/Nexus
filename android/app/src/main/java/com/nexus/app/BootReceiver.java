package com.nexus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            // Android 14–16 può vietare l'avvio di un dataSync FGS dal boot.
            // JobScheduler è il percorso ufficiale, persistente e OEM-aware.
            RecoveryScheduler.schedule(ctx);
        }
    }
}
