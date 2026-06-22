import { createClient } from '@supabase/supabase-js';

// Supabase configuration details
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://umeptngfntryekzxifvq.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtZXB0bmdmbnRyeWVrenhpZnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjgwNjQsImV4cCI6MjA5NzcwNDA2NH0.MTdlBNNfcreCAgGVD4wWHfCZMoOSd4_bDq753Wru_cI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured = 
  import.meta.env.VITE_SUPABASE_URL !== undefined && 
  import.meta.env.VITE_SUPABASE_ANON_KEY !== undefined;

export interface MockUser {
  id: string;
  email: string;
  name: string;
  domain: string;
  workspaceName: string;
  is_premium?: boolean;
  is_superadmin?: boolean;
}

// Wrapper object for direct auth and database operations
export const mockAuth = {
  // Sign up using email & password
  signUp: async (email: string, password?: string, name?: string, customWorkspaceName?: string) => {
    const domain = email.split('@')[1] || 'personal';
    const workspaceName = customWorkspaceName?.trim() || (
      !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase())
        ? `${domain.split('.')[0].toUpperCase()} Enterprise Workspace` 
        : 'Personal Workspace'
    );

    const { data, error } = await supabase.auth.signUp({
      email,
      password: password || 'DefaultPassword123!',
      options: {
        data: {
          name: name || email.split('@')[0],
          workspace_name: workspaceName,
          domain: domain,
          phone: '',
          is_premium: false
        }
      }
    });

    if (error) throw error;

    const user: MockUser = {
      id: data.user?.id || '',
      email: data.user?.email || email,
      name: name || email.split('@')[0],
      workspaceName,
      domain,
      is_superadmin: false
    };

    return { data: { user }, error: null };
  },

  // Sign in using email & password
  signIn: async (email: string, password?: string, customWorkspaceName?: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: password || 'DefaultPassword123!'
    });

    if (error) throw error;

    // Fetch profile from public.profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user?.id)
      .maybeSingle();

    const domain = email.split('@')[1] || 'personal';
    const user: MockUser = {
      id: data.user?.id || '',
      email: data.user?.email || email,
      name: profile?.name || email.split('@')[0].split('.').map((n: string) => n.charAt(0).toUpperCase() + n.slice(1)).join(' '),
      domain: profile?.domain || domain,
      workspaceName: profile?.workspace_name || customWorkspaceName || 'Personal Workspace',
      is_premium: profile?.is_premium || false,
      is_superadmin: profile?.is_superadmin || false
    };

    return { data: { user }, error: null };
  },

  // Passwordless OTP Phone Sign-In
  signInWithPhone: async (phone: string, customWorkspaceName?: string) => {
    // Attempt live OTP request if configured, otherwise do a mock fallback
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phone.replace(/\s+/g, ''),
        options: {
          data: {
            workspace_name: customWorkspaceName || 'Personal Workspace',
            name: `Phone User (${phone})`
          }
        }
      });
      if (error) throw error;
      return { data: { success: true }, error: null };
    } catch (err: any) {
      console.warn('[Supabase Client] Real SMS OTP dispatch failed or not configured in dashboard, running mock fallback session.', err.message);
      // Fallback session variables
      return { data: { success: true, isMocked: true }, error: null };
    }
  },

  // Validate Phone OTP
  verifyOTP: async (phone: string, code: string, name?: string, customWorkspaceName?: string) => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: phone.replace(/\s+/g, ''),
        token: code,
        type: 'sms'
      });

      if (error) throw error;

      // Fetch or insert profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user?.id)
        .maybeSingle();

      const user: MockUser = {
        id: data.user?.id || '',
        email: data.user?.email || `${phone.replace(/\D/g, '')}@phone.giinmeet.com`,
        name: profile?.name || name || `Phone User (${phone})`,
        workspaceName: profile?.workspace_name || customWorkspaceName || 'Personal Workspace',
        domain: profile?.domain || 'phone.giinmeet.com',
        is_premium: profile?.is_premium || false,
        is_superadmin: profile?.is_superadmin || false
      };

      return { data: { user }, error: null };
    } catch (err: any) {
      console.warn('[Supabase Client] Real verifyOtp failed, verifying virtual fallback mock session.', err.message);
      // Virtual session fallback
      const user: MockUser = {
        id: 'mock-phone-id-' + Math.random().toString(36).substr(2, 5),
        email: `${phone.replace(/\D/g, '')}@phone.giinmeet.com`,
        name: name || `Phone User (${phone})`,
        workspaceName: customWorkspaceName || 'Personal Workspace',
        domain: 'phone.giinmeet.com',
        is_premium: false,
        is_superadmin: false
      };
      return { data: { user }, error: null };
    }
  },

  // Fetch user profile from database
  getProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    return { data, error };
  },

  // Update profile details
  updateProfile: async (userId: string, name: string, _email: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ name, updated_at: new Date() })
      .eq('id', userId);
    return { data, error };
  },

  // Fetch all meetings linked to user_id
  getMeetings: async (userId: string) => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('user_id', userId)
      .order('time', { ascending: false });
    if (error) {
      console.warn('[Supabase Client] Failed to fetch meetings. Check if schema.sql was run.', error.message);
      return [];
    }
    return data || [];
  },

  // Save new meeting with auto-generated passcode
  createMeeting: async (meeting: { user_id: string; title: string; time: string; duration: string; status: string; host: string }) => {
    const passcode = Math.random().toString(36).substr(2, 6).toUpperCase();
    const payload = {
      ...meeting,
      passcode,
      admin_id: meeting.user_id
    };
    const { data, error } = await supabase
      .from('meetings')
      .insert([payload])
      .select()
      .single();
    if (error) {
      console.warn('[Supabase Client] Failed to create meeting.', error.message);
    }
    return data;
  },

  // Sync meeting workspace notes
  updateMeetingNotes: async (meetingId: string, notes: string, actionItemsCount: number, status?: string) => {
    const updatePayload: any = { notes, action_items_count: actionItemsCount };
    if (status) {
      updatePayload.status = status;
    }
    const { data, error } = await supabase
      .from('meetings')
      .update(updatePayload)
      .eq('id', meetingId);
    if (error) {
      console.warn('[Supabase Client] Failed to update meeting notes.', error.message);
    }
    return data;
  },

  // Fetch chat messages
  getMessages: async (threadId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[Supabase Client] Failed to fetch messages.', error.message);
      return [];
    }
    return data || [];
  },

  // Send message
  sendMessage: async (message: { thread_id: string; sender_name: string; text: string; user_id?: string }) => {
    const { data, error } = await supabase
      .from('messages')
      .insert([message])
      .select()
      .single();
    if (error) {
      console.warn('[Supabase Client] Failed to send message.', error.message);
    }
    return data;
  },

  // Fetch directory contacts belonging to the same workspace domain
  getContacts: async (domain: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('domain', domain);
    if (error) {
      console.warn('[Supabase Client] Failed to fetch workspace contacts.', error.message);
      return [];
    }
    return data || [];
  },

  // Fetch meeting details (passcode verification)
  getMeetingDetails: async (meetingId: string) => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .maybeSingle();
    return { data, error };
  },

  // Add participant to Waiting Room
  joinMeetingRoom: async (meetingId: string, name: string, userId?: string, role: string = 'Participant') => {
    const { data, error } = await supabase
      .from('meeting_participants')
      .insert([{
        meeting_id: meetingId,
        user_id: userId || null,
        name: name,
        status: role === 'Admin' ? 'Admitted' : 'Waiting',
        role: role
      }])
      .select()
      .single();
    if (error) {
      console.warn('[Supabase Client] Failed to join waitroom:', error.message);
    }
    return data;
  },

  // Check waiting status for participant
  checkParticipantStatus: async (participantId: string) => {
    const { data } = await supabase
      .from('meeting_participants')
      .select('status')
      .eq('id', participantId)
      .maybeSingle();
    return data?.status || 'Waiting';
  },

  // Get waiting participants for Host approval
  getWaitingParticipants: async (meetingId: string) => {
    const { data } = await supabase
      .from('meeting_participants')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('status', 'Waiting')
      .order('updated_at', { ascending: true });
    return data || [];
  },

  // Update participant status (Admit/Decline)
  updateParticipantStatus: async (participantId: string, status: 'Admitted' | 'Declined') => {
    const { data, error } = await supabase
      .from('meeting_participants')
      .update({ status, updated_at: new Date() })
      .eq('id', participantId);
    return { data, error };
  },

  // Get active admitted participants in the call room
  getAdmittedParticipants: async (meetingId: string) => {
    const { data } = await supabase
      .from('meeting_participants')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('status', 'Admitted');
    return data || [];
  },

  // Change meeting admin / designate new host
  changeMeetingAdmin: async (meetingId: string, newAdminId: string) => {
    const { data, error } = await supabase
      .from('meetings')
      .update({ admin_id: newAdminId })
      .eq('id', meetingId);
    return { data, error };
  },

  // Get all users in the system (for Superadmin)
  getAllProfiles: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true });
    return data || [];
  },

  // Update profile superadmin designation
  updateProfileSuperadmin: async (userId: string, isSuperadmin: boolean) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_superadmin: isSuperadmin })
      .eq('id', userId);
    return { data, error };
  },

  // Delete a user profile/account
  deleteProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    return { data, error };
  },

  // Toggle user Pro/Premium plan limits
  toggleProfilePremium: async (userId: string, isPremium: boolean) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_premium: isPremium })
      .eq('id', userId);
    return { data, error };
  },

  // Get all meetings (for Superadmin stats)
  getAllMeetings: async () => {
    const { data } = await supabase
      .from('meetings')
      .select('*');
    return data || [];
  }
};
