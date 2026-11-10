import { MemorySaver } from "@langchain/langgraph";
import fs from 'node:fs'
import path from 'node:path'


/**
 * Uint8Array 转 base64（无损二进制序列化，存入JSON）
 * @param {Uint8Array | undefined} arr
 * @returns {string | undefined}
 */
function uint8ToBase64(arr) {
    if (!arr) return undefined
    return Buffer.from(arr).toString('base64')
}

/**
 * base64 转回 Uint8Array
 * @param {string | undefined} str
 * @returns {Uint8Array | undefined}
 */
function base64ToUint8(str) {
    if (!str) return undefined
    return Buffer.from(str, 'base64')
}


/**
 * 自定义文件持久化检查点存储器 FileSaver
 * 继承 LangGraph 内置 MemorySaver，在内存存储的基础上增加本地文件落盘能力
 * 核心原理：先复用父类 MemorySaver 的内存读写逻辑，每次状态变更后触发保存到本地文件
 * 适用场景：简单本地调试，进程重启后可以恢复 agent 会话状态（threadId 对应的检查点）
 * 注意：仅适合单机本地开发，并发高、多进程场景不推荐，缺少文件锁会有覆盖丢失风险
 */
export class FileSaver extends MemorySaver {
    /**
     * 本地持久化文件路径，用来序列化存储全部会话检查点数据
     * 文件内部会保存所有 threadId 对应的 checkpoint、metadata、config 信息
     */
    filePath = ''

    // 类内部新增防抖私有变量、常量
    saveTimer = null
    static DEBOUNCE_MS = 300

    /**
     * @param filePath 本地存储文件绝对/相对路径
     * 构造函数：初始化路径，同时执行 load 从文件读取历史数据回填到内存
     */
    constructor(filePath) {
        super()
        this.filePath = filePath
        this.load()
    }


    /**
     * 加载方法
     * 读取本地文件中的持久化数据，解析后回填到父类 MemorySaver 的内存缓存中
     * 进程启动时自动调用，实现重启恢复会话记忆
     */
    load() {
        // 判断持久化文件是否存在，不存在直接跳过恢复
        if (fs.existsSync(this.filePath)) {
            try {
                // 读取本地json文件，解析成JS对象
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))

                // 恢复正式检查点快照 storage
                if (data.storage) {
                    // 第一层：遍历会话threadId
                    for (const [threadId, nsRecord] of Object.entries(data.storage)) {
                        this.storage[threadId] = {}
                        // 第二层：遍历命名空间ns，区分主图/子图
                        for (const [ns, cpRecord] of Object.entries(nsRecord)) {
                            this.storage[threadId][ns] = {}
                            // 第三层：遍历单条快照checkpointId
                            for (const [checkpointId, tuple] of Object.entries(cpRecord)) {
                                // this.storage[threadId][ns][checkpointId] = [
                                //     plainTextToUint8(tuple[0]),
                                //     plainTextToUint8(tuple[1]),
                                //     tuple[2], // 父快照ID是字符串，无需编码
                                // ]
                                this.storage[threadId][ns][checkpointId] = [
                                    base64ToUint8(tuple[0]),
                                    base64ToUint8(tuple[1]),
                                    tuple[2], // 父快照ID是字符串，无需编码
                                ]
                            }
                        }
                    }
                }

                // 恢复超步运行的增量临时数据 writes
                // 注意：writes 是超步运行过程中的临时增量数据，中断后可能不完整
                // 恢复不完整的 writes 会导致消息序列异常（如 tool_calls 缺少 tool 响应）
                // 因此中断恢复时只恢复 storage（完整检查点），丢弃 writes
                // if (data.writes) {
                //     for (const [outerKey, innerRecord] of Object.entries((data.writes))) {
                //         this.writes[outerKey] = {}
                //         for (const [innerKey, tuple] of Object.entries(innerRecord)) {
                //             this.writes[outerKey][innerKey] = [
                //                 tuple[0],
                //                 tuple[1],
                //                 base64ToUint8(tuple[2])
                //             ]
                //         }
                //     }
                // }
            } catch (e) {
                // 文件损坏、格式错误时捕获异常，不直接崩溃agent
                console.error('加载记忆失败', e)
            }
        }
    }


    /**
     * 保存方法
     * 将父类 MemorySaver 内存里全部检查点数据序列化，写入到 this.filePath 指定文件
     * 每次状态变更（新增/更新检查点）自动触发
     * 概念说明：
     * storage 里的一条记录，对应一轮 Pregel 超步（superstep）结束后固化生成的正式检查点快照。
     * 超步是 LangGraph图引擎的迭代轮次，属于框架层面的执行边界，不等同于业务上 Agent的一步 ReAct思考、一次工具调用或者一次模型推理。
     * 一轮超步内部可以并行执行多个节点、多次 putWrites增量更新；writes存放超步运行过程中未收敛的临时状态，不生成独立检查点。
    */
    save() {
        // 1. 初始化容器，准备组装要写入磁盘的数据
        // 注意：writes 是超步运行中的临时增量数据，中断后可能不完整，
        // 恢复时不读取 writes，因此这里也不持久化 writes，只保存完整检查点 storage
        const data = {
            storage: {}
        }

        // 2. 遍历 storage：完整检查点快照链表
        // 遍历 storage：按会话、命名空间、快照三层遍历
        // 将二进制 Uint8Array格式的检查点数据编码为base64，转为可JSON序列化结构
        for (const [threadId, nsRecord] of Object.entries(this.storage)) {
            // threadId：会话唯一ID
            data.storage[threadId] = {}
            for (const [ns, cpRecord] of Object.entries(nsRecord)) {
                // ns = checkpoint_ns 命名空间，空字符串代表主图，子图拥有独立命名空间
                data.storage[threadId][ns] = {}
                for (const [checkpointId, tuple] of Object.entries(cpRecord)) {
                    // checkpointId：单条快照唯一标识
                    // tuple = [checkpoint二进制, metadata二进制, 父快照ID]
                    data.storage[threadId][ns][checkpointId] = [
                        uint8ToBase64(tuple[0]),
                        uint8ToBase64(tuple[1]),
                        tuple[2]
                    ]
                }
            }
        }

        // 3. 目录兜底 + 写入文件
        const dir = path.dirname(this.filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        const content = JSON.stringify(data, null, 2)

        // Windows 下写入文件常见 EPERM 的根因：
        // - Defender/杀毒软件实时扫描锁定文件
        // - 多进程（如 dev 模式热重启 + 旧进程未退出）同时写同一文件
        // - 上一次 writeFileSync 的句柄尚未被操作系统回收
        // 应对策略：指数退避重试 + temp 文件原子替换兜底，总等待约 3 秒。
        const saved = this._writeWithRetry(content)
        if (!saved) {
            console.error('[FileSaver] 持久化失败: 多次重试后仍无法写入文件，可能被其他进程锁定')
        }
    }

    /**
     * 带指数退避重试的文件写入
     * 先尝试直接写目标文件；全部失败后降级为 temp 文件 + rename 原子替换。
     * @param {string} content 要写入的文本内容
     * @returns {boolean} 是否写入成功
     */
    _writeWithRetry(content) {
        // 第一阶段：直接写入目标文件，指数退避重试
        // 间隔：100ms, 200ms, 400ms, 800ms, 1600ms（共 5 次，累计约 3.1s）
        let delay = 100
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                fs.writeFileSync(this.filePath, content, 'utf8')
                return true
            } catch (e) {
                // 仅对 EPERM/EBUSY/EACCES 这类可重试的锁定错误重试
                const code = e?.code
                if (!['EPERM', 'EBUSY', 'EACCES', 'EMFILE'].includes(code)) {
                    console.error('[FileSaver] 写入失败(不可重试):', e?.message || e)
                    return false
                }
                // 退避等待
                const end = Date.now() + delay
                while (Date.now() < end) { /* busy wait */ }
                delay *= 2
            }
        }

        // 第二阶段：直接写入持续失败，降级为 temp 文件 + rename 原子替换
        // 用随机后缀的临时文件名，避免 Defender 对固定 .tmp 后缀的锁定
        const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                fs.writeFileSync(tmpPath, content, 'utf8')
                fs.renameSync(tmpPath, this.filePath)
                return true
            } catch (e) {
                // 清理可能残留的临时文件
                try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* ignore */ }
                const end = Date.now() + 200
                while (Date.now() < end) { /* busy wait */ }
            }
        }

        return false
    }


    /**
     * 修复消息序列中 role 为 undefined 的 ChatMessage
     *
     * 背景：智谱AI（glm-5.3-flashx）流式响应的部分分片不带 role 字段，
     * LangChain 会生成 ChatMessage(role=undefined)。该消息持久化后，
     * 下次请求发送给 API 时 messageToOpenAIRole 返回 undefined，
     * 触发 400 "角色信息不能为空"。
     *
     * 处理：将 type=generic 且 role=undefined 的消息的 role 兜底为 'assistant'，
     * 因为这类消息来源于模型响应，本质是 assistant 消息。
     * @param {Array} messages 消息数组
     */
    _sanitizeMessages(messages) {
        if (!Array.isArray(messages)) return
        for (const msg of messages) {
            if (
                msg &&
                typeof msg._getType === 'function' &&
                msg._getType() === 'generic' &&
                msg.role === undefined
            ) {
                msg.role = 'assistant'
            }
        }
    }

    /**
     * 获取指定配置对应的检查点元组
     * 在父类返回结果后，修复 checkpoint 中 role 为 undefined 的消息，
     * 避免历史脏数据在下次请求时触发 API 400 错误
     * @param config 会话配置（含 thread_id）
     * @returns {Promise<CheckpointTuple | undefined>}
     */
    async getTuple(config) {
        const tuple = await super.getTuple(config)
        if (tuple) {
            // 修复检查点快照中的消息
            if (tuple.checkpoint?.channel_values?.messages) {
                this._sanitizeMessages(tuple.checkpoint.channel_values.messages)
            }
            // 修复 pendingWrites 中的消息（超步运行中的增量数据）
            if (Array.isArray(tuple.pendingWrites)) {
                for (const write of tuple.pendingWrites) {
                    // write 结构: [taskId, channel, value]
                    if (write && write[1] === 'messages') {
                        if (Array.isArray(write[2])) {
                            this._sanitizeMessages(write[2])
                        } else if (write[2]) {
                            this._sanitizeMessages([write[2]])
                        }
                    }
                }
            }
        }
        return tuple
    }

    /**
     * 列出满足条件的检查点
     * 在父类返回结果后，逐个修复 checkpoint 中 role 为 undefined 的消息
     * @param config 过滤条件
     */
    async *list(config) {
        for await (const tuple of super.list(config)) {
            if (tuple.checkpoint?.channel_values?.messages) {
                this._sanitizeMessages(tuple.checkpoint.channel_values.messages)
            }
            if (Array.isArray(tuple.pendingWrites)) {
                for (const write of tuple.pendingWrites) {
                    if (write && write[1] === 'messages') {
                        if (Array.isArray(write[2])) {
                            this._sanitizeMessages(write[2])
                        } else if (write[2]) {
                            this._sanitizeMessages([write[2]])
                        }
                    }
                }
            }
            yield tuple
        }
    }

    /**
     * 写入检查点快照
     * 在调用父类方法前，修复 checkpoint 中 role 为 undefined 的消息，
     * 避免脏数据被持久化到本地文件
     * @param config 会话配置
     * @param checkpoint 图完整状态快照
     * @param metadata 检查点元数据
     */
    async put(config, checkpoint, metadata) {
        if (checkpoint?.channel_values?.messages) {
            this._sanitizeMessages(checkpoint.channel_values.messages)
        }
        const res = await super.put(config, checkpoint, metadata)
        // 将 config, checkpoint, metadata 这三个内容进行本地持久化
        // this.save()
        // 增加防抖
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => this.save(), FileSaver.DEBOUNCE_MS)
        return res
    }

    /**
     * 增量写入状态更新（putWrites）
     * 在调用父类方法前，修复 writes 中 role 为 undefined 的消息
     * @param config 会话配置（含 thread_id）
     * @param writes 本次变更的写入数组 [[channel, value], ...]
     * @param taskId 任务ID
     * @param taskPath 任务路径
     */
    async putWrites(config, writes, taskId, taskPath) {
        if (Array.isArray(writes)) {
            for (const write of writes) {
                // write 结构: [channel, value]
                if (write && write[0] === 'messages') {
                    if (Array.isArray(write[1])) {
                        this._sanitizeMessages(write[1])
                    } else if (write[1]) {
                        this._sanitizeMessages([write[1]])
                    }
                }
            }
        }
        await super.putWrites(config, writes, taskId, taskPath)
        // 增加防抖
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => this.save(), FileSaver.DEBOUNCE_MS)
    }

    /**
     * 删除指定会话的全部检查点
     * 先在内存中清除该 threadId 的所有数据，再同步更新本地文件
     * @param threadId 目标会话ID，和业务侧 stream 传入的 configurable.thread_id 对应
     */
    async deleteThread(threadId) {
        await super.deleteThread(threadId)
        // 删除是破坏性操作，必须立即落盘，先清掉待执行的防抖定时器，
        // 避免旧数据的 save() 覆盖删除结果
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        this.save()
    }
}
