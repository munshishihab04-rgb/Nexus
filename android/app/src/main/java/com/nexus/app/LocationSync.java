package com.nexus.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import java.util.concurrent.Executor;

public class LocationSync {
    private final Context ctx;
    private final NexusAPI api;

    public LocationSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
    }

    public void syncOnce() {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return;
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return;
            if (Build.VERSION.SDK_INT >= 28 && !lm.isLocationEnabled()) return;
            String provider = bestProvider(lm);
            if (provider == null) return;

            // A cached fix is useful only when reasonably recent. Otherwise actively request
            // a fresh one; getLastKnownLocation alone commonly returns null/stale on Samsung.
            Location cached = null;
            try { cached = lm.getLastKnownLocation(provider); } catch (Exception ignored) {}
            if (cached != null && System.currentTimeMillis() - cached.getTime() <= 2 * 60 * 1000L) {
                accept(cached);
                return;
            }

            if (Build.VERSION.SDK_INT >= 30) {
                Executor background = command -> new Thread(command, "nexus-location").start();
                lm.getCurrentLocation(provider, new CancellationSignal(), background, this::accept);
            } else {
                final android.location.LocationListener[] holder = new android.location.LocationListener[1];
                holder[0] = location -> {
                    try { lm.removeUpdates(holder[0]); } catch (Exception ignored) {}
                    accept(location);
                };
                lm.requestSingleUpdate(provider, holder[0], android.os.Looper.getMainLooper());
            }
        } catch (SecurityException ignored) {
        } catch (Exception e) { e.printStackTrace(); }
    }

    private String bestProvider(LocationManager lm) {
        try {
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) return LocationManager.NETWORK_PROVIDER;
        } catch (Exception ignored) {}
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER;
        } catch (Exception ignored) {}
        try {
            if (lm.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) return LocationManager.PASSIVE_PROVIDER;
        } catch (Exception ignored) {}
        return null;
    }

    private void accept(Location loc) {
        if (loc == null) return;
        try {
            SharedPreferences prefs = ctx.getSharedPreferences("nexus_location_state", Context.MODE_PRIVATE);
            double oldLat = Double.longBitsToDouble(prefs.getLong("lat", Double.doubleToLongBits(0d)));
            double oldLng = Double.longBitsToDouble(prefs.getLong("lng", Double.doubleToLongBits(0d)));
            long lastSent = prefs.getLong("sent", 0L);
            Location old = new Location("nexus_previous");
            old.setLatitude(oldLat);
            old.setLongitude(oldLng);
            long now = System.currentTimeMillis();
            boolean first = lastSent == 0L;
            boolean moved = !first && loc.distanceTo(old) >= RuntimeSyncPolicy.MIN_LOCATION_DISTANCE_METERS;
            boolean stale = now - lastSent >= RuntimeSyncPolicy.MAX_LOCATION_SILENCE_MS;
            if ((first || moved || stale) &&
                api.sendLocation(loc.getLatitude(), loc.getLongitude(), loc.getAccuracy())) {
                prefs.edit()
                    .putLong("lat", Double.doubleToLongBits(loc.getLatitude()))
                    .putLong("lng", Double.doubleToLongBits(loc.getLongitude()))
                    .putLong("sent", now)
                    .apply();
            }
        } catch (Exception e) { e.printStackTrace(); }
    }
}
