package app.sff.signal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Intent;
import android.media.RingtoneManager;
import android.media.AudioAttributes;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Native SFF notifications survive a closed WebView when FCM can deliver. */
public final class SffMessagingService extends FirebaseMessagingService {
  public static final String CALL_CHANNEL = "sff_incoming_calls";
  public static final String MESSAGE_CHANNEL = "sff_dm_messages";

  @Override public void onNewToken(String token) {
    super.onNewToken(token);
    getSharedPreferences("sff_push",0).edit().putString("fcm_token",token).apply();
    Main.deliverPushToken(token);
  }

  private PendingIntent openApp(int requestId) {
    Intent open = new Intent(this,Main.class)
      .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return PendingIntent.getActivity(this,requestId,open,
      PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  @Override public void onMessageReceived(RemoteMessage message) {
    final String type = message.getData().get("type");
    if ("dm_message".equals(type)) {
      showMessage(message);
      return;
    }
    if ("push_self_test".equals(type)) {
      showSelfTest();
      return;
    }
    if ("call_incoming".equals(type)) showCall(message);
  }

  private void showSelfTest() {
    final NotificationManager manager =
      (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
        MESSAGE_CHANNEL,"SFF privatne poruke",NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      manager.createNotificationChannel(channel);
    }
    manager.notify(4201,new Notification.Builder(this,MESSAGE_CHANNEL)
      .setSmallIcon(R.drawable.sff_status)
      .setContentTitle("SFF · Test notifikacije")
      .setContentText("Firebase poruka je stigla na ovaj telefon.")
      .setContentIntent(openApp(4201))
      .setAutoCancel(true)
      .setPriority(Notification.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .build());
  }

  private void showMessage(RemoteMessage message) {
    final String room = message.getData().get("room");
    final String messageId = message.getData().get("message_id");
    if (room == null || !room.matches("[1-9][0-9]{0,15}") ||
        messageId == null || !messageId.matches("[1-9][0-9]{0,15}")) return;
    // Don't duplicate an alert while the user is already viewing the app.
    if (Main.isForeground()) return;
    final long roomId;
    try { roomId=Long.parseLong(room); } catch (NumberFormatException e) { return; }
    final int notificationId = SffReplyReceiver.notificationId(roomId);
    String sender = message.getData().get("sender");
    if (sender == null || sender.isEmpty()) sender = "Prijatelj";
    sender = sender.replaceAll("[\\p{Cntrl}]", " ").trim();
    if (sender.length() > 80) sender = sender.substring(0,80);
    String body = message.getData().get("body");
    if (body == null || body.isEmpty()) body = "Nova poruka";
    body = body.replaceAll("[\\p{Cntrl}]", " ").trim();
    if (body.length() > 240) body = body.substring(0,240);

    final NotificationManager manager =
      (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
        MESSAGE_CHANNEL,"SFF privatne poruke",NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
      manager.createNotificationChannel(channel);
    }

    Intent replyIntent = new Intent(this,SffReplyReceiver.class)
      .setAction(SffReplyReceiver.ACTION_REPLY)
      .putExtra(SffReplyReceiver.EXTRA_ROOM,roomId)
      .putExtra(SffReplyReceiver.EXTRA_NOTIFICATION,notificationId);
    PendingIntent directReply = PendingIntent.getBroadcast(
      this,notificationId,replyIntent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    RemoteInput input = new RemoteInput.Builder(SffReplyReceiver.KEY_TEXT)
      .setLabel("Odgovori na poruku").build();
    Notification.Action replyAction = new Notification.Action.Builder(
      R.drawable.sff_status,"Odgovori",directReply).addRemoteInput(input)
      .setAllowGeneratedReplies(true).build();

    Notification.Builder builder = new Notification.Builder(this,MESSAGE_CHANNEL)
      .setSmallIcon(R.drawable.sff_status)
      .setContentTitle("SFF · " + sender)
      .setContentText(body)
      .setStyle(new Notification.BigTextStyle().bigText(body))
      .setContentIntent(openApp(notificationId))
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setPriority(Notification.PRIORITY_HIGH)
      .addAction(replyAction);
    manager.notify(notificationId,builder.build());
  }

  private void showCall(RemoteMessage message) {
    // The foreground activity already shows the call overlay and controls.
    if (Main.isForeground()) return;
    final String room = message.getData().get("room");
    final String kind = message.getData().get("kind");
    if (room == null || !room.matches("[1-9][0-9]{0,15}")) return;
    final boolean video = "video".equals(kind);
    final NotificationManager manager =
      (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(
        CALL_CHANNEL,"Dolazni SFF pozivi",NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        new AudioAttributes.Builder().setUsage(
          AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
      manager.createNotificationChannel(channel);
    }
    Notification.Builder builder = new Notification.Builder(this,CALL_CHANNEL)
      .setSmallIcon(R.drawable.sff_status)
      .setContentTitle(video ? "Dolazni SFF video poziv" : "Dolazni SFF poziv")
      .setContentText((message.getData().get("name") == null
        ? "Prijatelj" : message.getData().get("name")) + " te zove. Otvori SFF da se javiš.")
      .setContentIntent(openApp(4190))
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setPriority(Notification.PRIORITY_HIGH)
      .setTimeoutAfter(45000L);
    manager.notify(4190,builder.build());
  }
}
