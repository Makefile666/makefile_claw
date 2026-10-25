import fs from 'node:fs';
import { homedir } from 'node:os';
import {join} from 'node:path';

// 1. 生成智能体配置的路径（Agents 配置文件的路径）
const configPath = join(
    homedir(),
    '.makefile_claw',
    'makefile_claw.json',
);

// 2. 读取配置文件中的智能体配置信息
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
// console.log(config);


// 功能一、 读取到 agents 智能体的相关配置（agentsConfig）
export function readConfigByAgentName(agentName: string) {
    if(!agentName) {
    throw new Error('智能体不存在');
    }

    try {
        // 3. 根据智能体名称从 agents 数组中查找对应配置
        const agentsConfig = config.agents?.find((a: { name: string }) => a.name === agentName);
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
        const modelsConfig = config.models?.find((m: { name: string }) => m.name === modelName);
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
