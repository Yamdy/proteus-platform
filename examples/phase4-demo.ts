/**
 * Phase 4 多 Agent 协作 Demo
 *
 * 演示：coder agent 写代码，然后委托 reviewer agent 审查
 *
 * 运行：PROTEUS_LLM_API_KEY=<key> npx tsx examples/phase4-demo.ts
 */
import {
  AgentRegistry,
  AgentRouter,
  Harness,
  SessionContext,
  AgentContext,
  HandlerEngine,
  CostAttributionTracker,
  createInMemoryStore,
} from '../packages/core/src/index.js'
import { createDeepSeekProvider } from '../packages/core/src/llm/deepseek.js'
import type { Tool, ToolContext, ToolResult } from '../packages/core/src/types.js'

// ============================================================
// 1. 创建 LLM Provider
// ============================================================
const apiKey = process.env.PROTEUS_LLM_API_KEY
if (!apiKey) {
  console.error('请设置环境变量 PROTEUS_LLM_API_KEY')
  process.exit(1)
}

const coderLLM = createDeepSeekProvider({ apiKey, model: 'deepseek-chat' })
const reviewerLLM = createDeepSeekProvider({ apiKey, model: 'deepseek-chat' })

// ============================================================
// 2. 创建 Agent Registry 和 Router
// ============================================================
const registry = new AgentRegistry()
const costTracker = new CostAttributionTracker()
const router = new AgentRouter(registry, undefined, costTracker)

// ============================================================
// 3. 创建 Agent-as-Tool：把 reviewer 包装为工具
// ============================================================
function createReviewTool(): Tool {
  return {
    definition: {
      name: 'delegate_to_reviewer',
      description: '把代码交给 reviewer agent 审查，获取审查意见',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '需要审查的代码',
          },
        },
        required: ['code'],
      },
    },
    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const code = String(args.code ?? '')
      console.log('\n🔄 [Coder] 委托 reviewer 审查代码...')

      const result = await router.delegate({
        fromAgentId: 'coder',
        toAgentId: 'reviewer',
        task: `请审查以下代码，给出改进建议：\n\n${code}`,
      })

      if (!result.ok) {
        return { output: null, error: { message: result.reason, retryable: false } }
      }

      console.log('✅ [Reviewer] 审查完成')
      return {
        output: result.result.ok
          ? `审查完成，耗时 ${result.result.duration}ms`
          : `审查失败: ${result.result.error}`,
      }
    },
  }
}

// ============================================================
// 4. 注册 Agent
// ============================================================
const coderAgent = new AgentContext({
  llm: coderLLM,
  tools: new Map<string, Tool>([['delegate_to_reviewer', createReviewTool()]]),
  handlerEngine: new HandlerEngine(),
})

const reviewerAgent = new AgentContext({
  llm: reviewerLLM,
  tools: new Map(),
  handlerEngine: new HandlerEngine(),
})

registry.register('coder', coderAgent)
registry.register('reviewer', reviewerAgent)

// ============================================================
// 5. 运行
// ============================================================
async function main() {
  console.log('🚀 启动多 Agent 协作 Demo\n')
  console.log('Agent 列表:', registry.list().join(', '))
  console.log('─'.repeat(50))

  const harness = new Harness({ store: createInMemoryStore() })
  const session = new SessionContext({
    sessionId: 'demo-session',
    llm: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0 },
    tools: {},
    logLevel: 'info',
  })

  session.workingMemory.push({
    role: 'user',
    content: '请写一个快速排序函数（TypeScript），然后调用 delegate_to_reviewer 让 reviewer 审查',
  })

  console.log('\n📝 [User] 请写一个快速排序函数，然后让 reviewer 审查\n')

  const result = await harness.runTurn(session, coderAgent)

  console.log('\n' + '─'.repeat(50))
  console.log('📊 执行结果:')
  console.log(`   状态: ${result.status}`)

  // 显示成本
  const allCosts = costTracker.getAllEntries()
  if (allCosts.length > 0) {
    console.log('\n💰 成本归因:')
    for (const entry of allCosts) {
      console.log(`   ${entry.agentId}: ${entry.tokens} tokens, $${entry.cost.toFixed(6)}`)
    }
    console.log(`   coder 总成本 (含子 agent): $${costTracker.getTotalCost('coder').toFixed(6)}`)
  }

  // 显示最终消息
  const messages = session.workingMemory.getMessages()
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop()
  if (lastAssistant) {
    console.log('\n🤖 [Coder] 最终回复:')
    console.log(lastAssistant.content.slice(0, 500))
  }
}

main().catch(console.error)
