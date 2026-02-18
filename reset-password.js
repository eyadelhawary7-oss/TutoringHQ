require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

(async () => {
  const { data, error } = await supabase.auth.admin.updateUserById(
    '33af7171-2e39-40af-aacf-864221bea14d',
    { 
      password: '123456',
      email_confirm: true,
      app_metadata: { provider: 'email', providers: ['email', 'phone'] }
    }
  );
  console.log('Result:', data);
  if (error) console.log('Error:', error);
})();