import { initChatModel } from 'langchain'

// 初始化流式模型
export async function initStreamModel(modelconfig: any): Promise<any> {
    // 获取模型的配置信息（名字、基础URL、APIKey、是否使用环境变量获取APIKey、温度参数）
    const modelName = modelconfig.id;
    const modelProvider = modelconfig.provider.toLowerCase();
    const modelBaseUrl = modelconfig.base_url;
    const modelApiKey = modelconfig.api_key;
    // 如果是使用环境变量获取 APIKey，则 modelUseEnvApiKey 为 true，否则为 false
    const modelUseEnvApiKey = modelconfig.api_key_from_env === 1;
    const modelTemperature = modelconfig.temperature;

    return initChatModel(modelName, {
        modelProvider: modelProvider,
        configuration: {
            baseUrl: modelBaseUrl,
            // 如果使用环境变量获取 APIKey（即：modelUseEnvApiKey 为 true），则从环境变量中获取；
            // 否则直接使用配置文件中的 APIKey
            apiKey: modelUseEnvApiKey ? process.env[modelApiKey] : modelApiKey,
            temperature: modelTemperature,
        },
        streaming: true,
    })
}

