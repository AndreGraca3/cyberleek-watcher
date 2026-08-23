const config = require('../src/config');
const { sendDiscordAlert } = require('../src/notifier');

(async () => {
  const sampleLeak = {
    pubkey: 'TEST_ALERT_VERIFICATION_KEY_11111111111111',
    timestamp: Math.floor(Date.now() / 1000),
    title: 'TEST ALERT: Watcher is Online & Connected',
    items: [
      { label: 'Discord Webhook Test', url: 'https://cyberleek.ar.io/' }
    ]
  };

  console.log('Sending test alert to Discord...');
  const result = await sendDiscordAlert(sampleLeak);
  if (result.success) {
    console.log('✅ Test alert delivered successfully to Discord!');
  } else {
    console.error('❌ Failed to deliver alert:', result);
  }
})();
