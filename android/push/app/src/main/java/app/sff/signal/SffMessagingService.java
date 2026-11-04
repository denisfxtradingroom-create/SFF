package app.sff.signal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.media.RingtoneManager;
import android.media.AudioAttributes;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Receives Android notifications when the SFF WebView is not running. */
public final class SffMessagingService extends FirebaseMessagingService {
  public static final String CHANNEL = "sff_incoming_calls";

  @Override public void onNewToken(String token) {
    super.onNewToken(token);
    getSharedPreferences("sff_push",0).edit().putString("fcm_token",token).apply();
    Main.deliverPushToken(token);
  }

  @Override public void onMessageReceived(RemoteMessage message) {
    if (!"call_incoming".equals(message.getData().get("type"))) return;
    final String room = message.getData().get("room");
    final String kind = message.getData().get("kind");
    if (room == null || !room.matches("[1-9][0-9]{0,15}")) return;
    final boolean video = "video".equals(kind);
    final NotificationManager manager =
      (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
        CHANNEL,"Dolazni SFF pozivi",NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        new AudioAttributes.Builder().setUsage(
          AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
      manager.createNotificationChannel(channel);
    }
    Intent open = new Intent(this,Main.class)
      .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this,0,open,
      PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder builder = Build.VERSION.SDK_INT >= 26
      ? new Notification.Builder(this,CHANNEL) : new Notification.Builder(this);
    builder.setSmallIcon(getResources().getIdentifier("mark","drawable",getPackageName()))
      .setContentTitle(video ? "Dolazni SFF video poziv" : "Dolazni SFF poziv")
      .setContentText("Otvori SFF da se javiš.")
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setPriority(Notification.PRIORITY_HIGH)
      .setTimeoutAfter(45000L);
    manager.notify(4190,builder.build());
  }
}
