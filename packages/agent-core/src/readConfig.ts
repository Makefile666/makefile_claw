import fs from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** 配置文件路径：通过 getBaseDir 解析，支持 MAKEFILE_CLAW_HOME 覆盖（便于测试隔离） */
function getConfigPath(): string {
    return join(getBaseDir(), 'makefile_claw.json');
}

/**
 * 读取配置文件。
 * 注意：必须每次调用都从磁盘重新读取，不能在模块加载时缓存。
 * 配置文件会被 Web UI 实时修改（新增/改名 Agent、Model），
 * 若缓存到模块作用域，本进程在不重启的情况下永远读不到新配置。
 */
function loadConfig(): any {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
}

/** 读取完整配置（agents / models / tools / mcpServers / teams） */
export function readConfig(): any {
    return loadConfig();
}


// 功能一、 读取到 agents 智能体的相关配置（agentsConfig）
export function readConfigByAgentName(agentName: string) {
    if(!agentName) {
    throw new Error('智能体不存在');
    }

    try {
        // 3. 根据智能体名称从 agents 数组中查找对应配置
        const agentsConfig = loadConfig().agents?.find((a: { name: string }) => a.name === agentName);
        // console.log(agentsConfig);

        // 4. 没找到对应智能体配置，返回 null
        if (!agentsConfig) {
            return null;
        }

        return agentsConfig;
    } catch (error) {
        console.error(error);
        // 读取或解析失败，返回 null
        return null;
    }
}

// 功能二、 读取到 models 模型的相关配置（modelsConfig）
export function readConfigByModelName(modelName: string) {
    if(!modelName) {
    throw new Error('模型不存在');
    }
    
    try {
        // 3. 根据模型名称从 models 数组中查找对应配置
        const modelsConfig = loadConfig().models?.find((m: { name: string }) => m.name === modelName);
        // console.log(modelsConfig);

        // 4. 没找到对应模型配置，返回 null
        if (!modelsConfig) {
            return null;
        }

        return modelsConfig;
    } catch (error) {
        console.error(error);
        // 读取或解析失败，返回 null
        return null;
    }
}
