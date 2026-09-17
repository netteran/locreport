'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/admin')
      router.refresh()
    }
  }

  return (
    <div
      className="container flex items-center justify-center"
      style={{ minHeight: '60vh', paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}
    >
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center" style={{ color: 'var(--text)' }}>
          Sign in to LocReport
        </h1>
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
            <Button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
