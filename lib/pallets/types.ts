export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'pending' | 'disabled'

export interface AppUser {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: UserRole
  status: UserStatus
  created_at: string
  updated_at: string
}
