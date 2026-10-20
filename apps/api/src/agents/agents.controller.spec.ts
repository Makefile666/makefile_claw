import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import type { AgentConfig } from '../claw-config/claw-config.types.js';
import type { CreateAgentDto, UpdateAgentDto } from './agents.types.js';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: AgentsService;

  const mockAgent: AgentConfig = {
    id: 'agent_test_001',
    name: 'TestAgent',
    description: 'test description',
    model: 'model_1',
    systemPrompt: 'you are helpful',
    tools: ['web_search'],
    active: 1,
    createdAt: 1234567890,
  };

  const mockAgentsService = {
    findAll: vi.fn().mockReturnValue([mockAgent]),
    findOne: vi.fn().mockImplementation((id: string) => {
      if (id === mockAgent.id) return mockAgent;
      throw new NotFoundException(`Agent ${id} 不存在`);
    }),
    create: vi.fn().mockImplementation((dto: CreateAgentDto) => ({
      ...dto,
      id: 'agent_new_001',
      createdAt: Date.now(),
    })),
    update: vi.fn().mockImplementation((id: string, dto: UpdateAgentDto) => {
      if (id === mockAgent.id) return { ...mockAgent, ...dto };
      throw new NotFoundException(`Agent ${id} 不存在`);
    }),
    remove: vi.fn().mockImplementation((id: string) => {
      if (id !== mockAgent.id) throw new NotFoundException(`Agent ${id} 不存在`);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useValue: mockAgentsService }],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get<AgentsService>(AgentsService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/agents', () => {
    it('should return all agents wrapped in ApiResponse', () => {
      const result = controller.findAll();
      expect(result.code).toBe(0);
      expect(result.msg).toBe('success');
      expect(result.data).toEqual([mockAgent]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('GET /api/agents/:id', () => {
    it('should return the agent when id exists', () => {
      const result = controller.findOne(mockAgent.id);
      expect(result.code).toBe(0);
      expect(result.data).toEqual(mockAgent);
      expect(service.findOne).toHaveBeenCalledWith(mockAgent.id);
    });

    it('should throw NotFoundException when id does not exist', () => {
      expect(() => controller.findOne('nonexistent')).toThrow(NotFoundException);
    });
  });

  describe('POST /api/agents', () => {
    it('should create and return a new agent', () => {
      const dto: CreateAgentDto = {
        name: 'NewAgent',
        description: 'new desc',
        model: 'model_2',
        systemPrompt: 'prompt',
        tools: [],
        active: 1,
      };
      const result = controller.create(dto);
      expect(result.code).toBe(0);
      expect(result.msg).toBe('创建成功');
      expect(result.data.id).toBe('agent_new_001');
      expect(result.data.name).toBe('NewAgent');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('PUT /api/agents/:id', () => {
    it('should update and return the agent', () => {
      const dto: UpdateAgentDto = { name: 'UpdatedAgent' };
      const result = controller.update(mockAgent.id, dto);
      expect(result.code).toBe(0);
      expect(result.msg).toBe('更新成功');
      expect(result.data.name).toBe('UpdatedAgent');
      expect(service.update).toHaveBeenCalledWith(mockAgent.id, dto);
    });

    it('should throw NotFoundException when id does not exist', () => {
      expect(() => controller.update('nonexistent', {})).toThrow(NotFoundException);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('should return success when deletion succeeds', () => {
      const result = controller.remove(mockAgent.id);
      expect(result.code).toBe(0);
      expect(result.msg).toBe('删除成功');
      expect(result.data).toBeNull();
      expect(service.remove).toHaveBeenCalledWith(mockAgent.id);
    });

    it('should throw NotFoundException when id does not exist', () => {
      expect(() => controller.remove('nonexistent')).toThrow(NotFoundException);
    });
  });
});
