import 'dotenv/config';
import { initAgent, agentSessions } from './lib/agent.js';

async function main() {
  console.log('Testing initAgent...');
  try {
    const session = await initAgent('test:123');
    console.log('Agent session created!');
    
    // Test a simple prompt
    let fullText = '';
    const unsubscribe = session.subscribe((event) => {
      try {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          fullText += event.assistantMessageEvent.delta;
          process.stdout.write(event.assistantMessageEvent.delta);
        }
      } catch (e) {
        console.error('Subscribe error:', e.message);
      }
    });
    
    console.log('\nSending prompt...');
    await session.prompt('Tampilkan semua produk');
    unsubscribe();
    
    console.log('\n\nFull response length:', fullText.length);
    console.log('Response:', fullText.slice(0, 500));
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  }
  process.exit(0);
}

main();
