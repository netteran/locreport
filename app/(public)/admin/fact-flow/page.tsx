import { createServiceClient } from '@/lib/supabase/server'
import { FactFlowAdmin } from './FactFlowAdmin'
import { loadAdminFacts } from '@/lib/adminFacts'

export const dynamic = 'force-dynamic'

export default async function AdminFactFlowPage() {
  try {
    const facts = await loadAdminFacts(createServiceClient())
    return <FactFlowAdmin initialFacts={facts} />
  } catch (error) {
    return <div>
      <h1 className="text-2xl font-bold mb-4">Fact Flow</h1>
      <p role="alert" className="text-red-600">
        {error instanceof Error ? error.message : 'Could not load Fact Flow.'}
      </p>
      <p className="mt-3 text-sm">Reload this page after resolving the error. Facts have not been changed.</p>
    </div>
  }
}
