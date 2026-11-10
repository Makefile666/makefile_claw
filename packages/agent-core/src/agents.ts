import { initChatModel, SystemMessage, HumanMessage, AIMessage } from 'langchain'

// // 初始化流式模型
// export async function initStreamModel(modelconfig: any): Promise<any> {
//     // 获取模型的配置信息（名字、基础URL、APIKey、是否使用环境变量获取APIKey、温度参数）
//     const modelName = modelconfig.id;
//     const modelProvider = modelconfig.provider.toLowerCase();
//     const modelBaseUrl = modelconfig.base_url;
//     const modelApiKey = modelconfig.api_key;
//     // 如果是使用环境变量获取 APIKey，则 modelUseEnvApiKey 为 true，否则为 false
//     const modelUseEnvApiKey = modelconfig.api_key_from_env === 1;
//     const modelTemperature = modelconfig.temperature;
//
//     return initChatModel(modelName, {
//         modelProvider: modelProvider,
//         configuration: {
//             baseUrl: modelBaseUrl,
//             // 如果使用环境变量获取 APIKey（即：modelUseEnvApiKey 为 true），则从环境变量中获取；
//             // 否则直接使用配置文件中的 APIKey
//             apiKey: modelUseEnvApiKey ? process.env[modelApiKey] : modelApiKey,
//             temperature: modelTemperature,
//         },
//         streaming: true,
//     })
// }

export default {
    SystemMessage,
    HumanMessage,
    AIMessage,
}


import { ChatOpenAI } from '@langchain/openai';
import * as process from "node:process";
import type { BaseMessage } from '@langchain/core/messages';
import { createRequire } from 'node:module';

// 拦截 tiktoken 远程 CDN 请求，改用 js-tiktoken 内置的本地 cl100k_base 编码数据，解决网络不通造成的 token 计数超时卡顿问题。
function patchTiktokenFetch() {
    try {
        const require = createRequire(import.meta.url)
        const corePkgPath = require.resolve('@langchain/core/package.json')
        const coreRequire = createRequire(corePkgPath)
        // 从 js-tiktoken 加载内嵌的 cl100k_base 编码数据
        const cl100kBase = coreRequire('js-tiktoken/ranks/cl100k_base')
        const localEncodings: Record<string, unknown> = {
            cl100k_base: cl100kBase,
        }

        const originalFetch = globalThis.fetch.bind(globalThis)
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (url.startsWith('https://tiktoken.pages.dev/js/')) {
                const encodingName = url.split('/').pop()?.replace('.json', '') || 'cl100k_base'
                const data = localEncodings[encodingName] || localEncodings.cl100k_base
                return Promise.resolve(new Response(JSON.stringify(data), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }))
            }
            return originalFetch(input, init)
        }) as typeof fetch
    } catch (e) {
        // 降级：不拦截，让 LangChain 走默认的近似计数逻辑
        console.warn('[tiktoken-patch] 本地编码加载失败，使用网络获取或近似计数:', e)
    }
}

patchTiktokenFetch()

// 定义token元数据类型
interface UsageMetadata {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    output_token_details?: {
        reasoning: number;
    };
}


export async function initStreamModel(modelconfig: any): Promise<any> {
    const modelName = modelconfig.id
    const modelBaseUrl = modelconfig.base_url
    const modelApiKey = modelconfig.api_key;
    // 如果是使用环境变量获取 APIKey，则 modelUseEnvApiKey 为 true，否则为 false
    const modelUseEnvApiKey = modelconfig.api_key_from_env === 1;
    const modelTemperature = 0.7

    // 直接使用 ChatOpenAI 而非 initChatModel。
    const model = new ChatOpenAI({
        model: modelName,
        apiKey: modelUseEnvApiKey ? process.env[modelApiKey] : modelApiKey,
        temperature: modelTemperature,
        // HTTP 请求超时：模型 API 长时间不响应时快速失败，
        // 避免整个 agent.stream() 一直挂到 RUN_TIMEOUT_MS 才被 abort。
        // 设为 120s，覆盖单轮模型推理（含工具调用后的思考），但不会无限等待。
        timeout: 120_000,
        // 禁用自动重试：超时后立即失败，由上层统一处理，避免重试进一步拉长等待时间
        maxRetries: 0,
        configuration: {
            baseURL: modelBaseUrl
        },
        streaming: true,
        extraBody: {
            tool_stream: true, // 开启智谱工具参数流式分片输出
            // thinking: { type: "enabled" } // 开启思考内容 reasoning_content
        },
    } as any)

    // 智谱流式分片 reasoning_content 缺少 role，LangChain 转换后生成 role 为 undefined 消息，持久化后上报触发 400，需重写分片转换方法与 withConfig 保证新实例同样生效。
    // 定义修复函数，可复用于新实例
    const applyRoleFix = (targetModel: any) => {
        const completions = targetModel.completions
        const originalConvert = completions?._convertCompletionsDeltaToBaseMessageChunk?.bind(completions)
        if (originalConvert && !completions._zhipuRoleFixed) {
            completions._convertCompletionsDeltaToBaseMessageChunk = (delta: any, rawResponse: any, defaultRole: any) => {
                const fixedDelta = { ...delta }
                if (!fixedDelta.role) {
                    delete fixedDelta.role
                }
                return originalConvert(fixedDelta, rawResponse, defaultRole || 'assistant')
            }
            completions._zhipuRoleFixed = true
        }
    }

    // 对原始模型应用修复
    applyRoleFix(model)

    // 重写 withConfig，确保 bindTools 创建的新实例也应用修复
    const originalWithConfig = model.withConfig.bind(model)
    model.withConfig = function (config: any) {
        const newModel = originalWithConfig(config)
        applyRoleFix(newModel)
        return newModel
    }

    return model
}


