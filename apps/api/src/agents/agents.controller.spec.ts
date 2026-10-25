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
    name: 'TestAgent',
    description: 'test description',
    model: 'model_1',
    systemPrompt: 'you are helpful',
    tools: ['web_search'],
    active: 1,
  };

  const mockAgentsService = {
    findAll: vi.fn().mockReturnValue([mockAgent]),
    findOne: vi.fn().mockImplementation((name: string) => {
      if (name === mockAgent.name) return mockAgent;
      throw new NotFoundException(`Agent ${name} 不存在`);
    }),
    create: vi.fn().mockImplementation((dto: CreateAgentDto) => ({
      ...dto,
    })),
    update: vi.fn().mockImplementation((name: string, dto: UpdateAgentDto) => {
      if (name === mockAgent.name) return { ...mockAgent, ...dto };
      throw new NotFoundException(`Agent ${name} 不存在`);
    }),
    remove: vi.fn().mockImplementation((name: string) => {
      if (name !== mockAgent.name) throw new NotFoundException(`Agent ${name} 不存在`);
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

  describe('GET /api/agents/:name', () => {
    it('should return the agent when name exists', () => {
      const result = controller.findOne(mockAgent.name);
      expect(result.code).toBe(0);
      expect(result.data).toEqual(mockAgent);
      expect(service.findOne).toHaveBeenCalledWith(mockAgent.name);
    });

    it('should throw NotFoundException when name does not exist', () => {
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
      expect(result.data.name).toBe('NewAgent');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('PUT /api/agents/:name', () => {
    it('should update and return the agent', () => {
      const dto: UpdateAgentDto = { name: 'UpdatedAgent' };
      const result = controller.update(mockAgent.name, dto);
      expect(result.code).toBe(0);
      expect(result.msg).toBe('更新成功');
      expect(result.data.name).toBe('UpdatedAgent');
      expect(service.update).toHaveBeenCalledWith(mockAgent.name, dto);
    });

    it('should throw NotFoundException when name does not exist', () => {
      expect(() => controller.update('nonexistent', {})).toThrow(NotFoundException);
    });
  });

  describe('DELETE /api/agents/:name', () => {
    it('should return success when deletion succeeds', () => {
      const result = controller.remove(mockAgent.name);
      expect(result.code).toBe(0);
      expect(result.msg).toBe('删除成功');
      expect(result.data).toBeNull();
      expect(service.remove).toHaveBeenCalledWith(mockAgent.name);
    });

    it('should throw NotFoundException when name does not exist', () => {
      expect(() => controller.remove('nonexistent')).toThrow(NotFoundException);
    });
  });
});
