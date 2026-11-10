import { createMakefileClawAgent } from "./index.js";

// 判断是否在思考中（是否有思考过程）
function hasThinking(messageChunk: any) {
    // !! 表示将值转换为布尔值
    return !!messageChunk.additional_kwargs?.reasoning_content
}
// 打印思考过程（{ streamMode: 'messages' } 模式下使用）
function printThinking(messageChunk: any) {
    process.stdout.write(`${messageChunk.additional_kwargs.reasoning_content}`)
}

// 判断是否有正式回答的内容
function hasAnswer(messageChunk: any) {
    return !!messageChunk.content
}
// 打印正式回答的内容
function printAnswer(messageChunk: any) {
    process.stdout.write(`${messageChunk.content}`)
}

// 判断是否有符合用户需求的调用工具的内容
function hasToolCalls(messageChunk: any) {
    // 若 tool_calls 存在且长度大于 0，则说明存在调用工具的内容
    return messageChunk.tool_calls && messageChunk.tool_calls.length > 0
}
// 打印符合用户需求的调用工具的内容（工具的名称和参数内容）
function printToolCalls(messageChunk: any) {
    const toolCalls = messageChunk.tool_calls
    for (const toolCall of toolCalls) {
        if (toolCall.name) {
            process.stdout.write(`工具名称: ${toolCall.name}\n`)
            process.stdout.write(`工具参数: ${JSON.stringify(toolCall.args)}\n`)
            process.stdout.write(`工具ID: ${toolCall.id}`)
        }
    }
}

// 判断当前这个消息分片，是否包含工具调用的结果
function hasToolCallResult(messageChunk: any) {
    return !!messageChunk.tool_call_id
}

// 判断当前步骤是否执行结束
function isEnd(messageChunk: any) {
    // 若不在思考中，也没有正式回答内容，也没有调用工具的内容，则说明当前步骤执行结束
    return !hasThinking(messageChunk) && !hasAnswer(messageChunk) && !hasToolCalls(messageChunk)
}


async function runAgent() {
    const threadId = 'df8f5a9b-6016-49f0-914d-e7225e0cbd57'
    const message = '执行 ls'
    // 全局运行超时，超时后 abort 信号触发，进入 catch 再由 finally 强制清理
    const RUN_TIMEOUT_MS = 90 * 1000
    const { agent, close, checkpointer } = await createMakefileClawAgent('TestAgent', threadId);

    try{
        const response = await agent.stream({
                messages: [
                    { role: 'user', content: message }
                ]
            },
            // 流式输出模式，只返回最新消息，这个很关键，没有这个 streamMode 就没有下面的 messages 数组
            {
                streamMode: 'messages',
                configurable: {
                    thread_id: threadId,
                },
                // 超时墙：90s 后自动中断流，等价于强制进入清理的超时兜底
                signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
            },
        );

        let stepStart = false
        let stepEnd = false
        let currentStep = 0
        let startThinking = false

        console.log('-------------------------------------------------')
        console.log(message)
        console.log('-------------------------------------------------')

        for await (const chunk of response) {
            const [messageChunk, metadata] = chunk;
            const step = metadata.langgraph_step;

            if (step > currentStep) {
                // 步骤开始
                stepStart = true
                // 将当前步骤设置为新步骤
                currentStep = step
                stepEnd = false
                console.log(`\n[第${step}步] 开始执行`)
            }

            // 若有思考过程，则将 startThinking 设置为 true，并打印思考过程
            if (!startThinking && hasThinking(messageChunk)) {
                startThinking = true
                process.stdout.write(`思考过程\n`)
            }
            // 判断是否在思考中（是否有思考内容）
            if (hasThinking(messageChunk)) {
                startThinking = true
                // 若思考中（有思考过程），则打印思考过程（用黄色字体输出）
                printThinking(messageChunk)
            }
            // 若之前思考过，现在不在思考了，则将 startThinking 设置为 false，并打印一个空行，表示思考结束
            if (startThinking && !hasThinking(messageChunk)) {
                startThinking = false
                // 打印一个空行，表示思考结束
                console.log()
                if (hasAnswer(messageChunk)) {
                    process.stdout.write(`\n正式回答\n`)
                }
            }

            // 若有调用工具的结果，则打印调用工具的结果
            if (hasToolCallResult(messageChunk)) {
                console.log("工具调用的结果：")
                // 若有调用工具的结果，则打印调用工具的结果
                printAnswer(messageChunk)
                console.log()
            } else if (hasAnswer(messageChunk)) {
                // 若有正式回答内容，则打印正式回答内容（用绿色字体输出）
                printAnswer(messageChunk)
            }

            // 是否有工具的信息
            if (hasToolCalls(messageChunk)) {
                process.stdout.write('\n【开始调用工具】\n')
                // 若有工具信息，则打印工具信息
                printToolCalls(messageChunk)
            }
            if (isEnd(messageChunk) && !stepEnd) {
                // 若当前步骤执行结束，则打印执行结束信息
                console.log(`\n[第${step}步] 执行结束`)
                stepEnd = true
            }
        }
    } catch (err) {
        // 超时或运行异常都先记录，不中断流程，随后由 finally 强制回收终端
        console.error('【Agent运行异常或超时】', err)
    } finally {
        // close 内部先强制回收所有残留终端，再等待 MCP 客户端和 npx 子进程真正关闭
        await close()

        // 清空 FileSaver 的防抖定时器，并立即执行一次落盘，
        // 避免 300ms 定时器挂在事件循环上导致进程无法干净退出
        if (checkpointer.saveTimer) {
            clearTimeout(checkpointer.saveTimer)
            checkpointer.saveTimer = null
            checkpointer.save()
        }

        // 关键：强制进程立即退出。
        // 即使前面已 close() 了 MCP 客户端、清理了定时器，
        // Windows 下仍可能有残留句柄/子进程附着在控制台，
        // 导致终端被"刷新"、主流程输出的尾部被截断。
        // process.exit 会同步刷新 stdout/stderr 后再退出，不会丢日志。
        process.exit(0)
    }
}

runAgent();
