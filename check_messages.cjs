const { createClient } = require('./node_modules/@supabase/supabase-js');
const supabase = createClient(
  'https://umeptngfntryekzxifvq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtZXB0bmdmbnRyeWVrenhpZnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjgwNjQsImV4cCI6MjA5NzcwNDA2NH0.MTdlBNNfcreCAgGVD4wWHfCZMoOSd4_bDq753Wru_cI'
);

async function check() {
  console.log('Logging in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'mensahqsukujr@gmail.com',
    password: 'DefaultPassword123!'
  });

  if (authError) {
    console.error('Auth error:', authError.message);
    return;
  }
  console.log('Logged in successfully as:', authData.user.email);

  const { data: messages, error: msgError } = await supabase.from('messages').select('*');
  if (msgError) {
    console.error('Messages fetch error:', msgError.message);
  } else {
    console.log('--- MESSAGES ---');
    console.log(JSON.stringify(messages, null, 2));
  }
}

check();
