// Supabase configuration and fallback mock client logic
// Use environment variables or local placeholders
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured = 
  import.meta.env.VITE_SUPABASE_URL !== undefined && 
  import.meta.env.VITE_SUPABASE_ANON_KEY !== undefined;

// Mock database storage for preview virtualization
interface MockUser {
  id: string;
  email: string;
  name: string;
  domain: string;
  workspaceName: string;
}

const defaultMockUsers: MockUser[] = [
  { id: 'u1', email: 'lucas@company.com', name: 'Lucas Lima', domain: 'company.com', workspaceName: 'Company Corp Workspace' },
  { id: 'u2', email: 'sarah@company.com', name: 'Sarah Jenkins', domain: 'company.com', workspaceName: 'Company Corp Workspace' },
  { id: 'u3', email: 'theresa@company.com', name: 'Theresa Watson', domain: 'company.com', workspaceName: 'Company Corp Workspace' },
];

export const mockAuth = {
  getUsersByDomain: (domain: string) => {
    return defaultMockUsers.filter(u => u.domain === domain);
  },
  signUp: async (email: string, name: string, customWorkspaceName?: string) => {
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 800));
    const domain = email.split('@')[1] || 'personal';
    const workspaceName = customWorkspaceName?.trim() || (
      !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase())
        ? `${domain.split('.')[0].toUpperCase()} Enterprise Workspace` 
        : 'Personal Workspace'
    );

    const newUser: MockUser = {
      id: Math.random().toString(36).substr(2, 9),
      email,
      name,
      domain,
      workspaceName
    };
    
    // In a real application, we would insert this record into Supabase auth/public tables
    return { data: { user: newUser }, error: null };
  },
  signIn: async (email: string, customWorkspaceName?: string) => {
    await new Promise(resolve => setTimeout(resolve, 800));
    const domain = email.split('@')[1] || 'personal';
    const workspaceName = customWorkspaceName?.trim() || (
      !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase())
        ? `${domain.split('.')[0].toUpperCase()} Enterprise Workspace` 
        : 'Personal Workspace'
    );

    const user: MockUser = {
      id: 'mock-user-id',
      email,
      name: email.split('@')[0].split('.').map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(' '),
      domain,
      workspaceName
    };
    return { data: { user }, error: null };
  }
};
