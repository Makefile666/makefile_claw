import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import { TeamsService } from './teams.service.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  renameSync: vi.fn(),
}));

describe('TeamsService', () => {
  let clawConfigService: ClawConfigService;
  let service: TeamsService;
  let savedConfig: any = null;

  const baseConfig = () => ({
    agents: [
      { name: 'coder', description: '', model: 'm', systemPrompt: '', tools: [], active: 1 },
      { name: 'reviewer', description: '', model: 'm', systemPrompt: '', tools: [], active: 1 },
      { name: 'sup', description: '', model: 'm', systemPrompt: '', tools: [], active: 1 },
    ],
    models: [],
    tools: [],
    mcpServers: [],
    teams: [],
  });

  beforeEach(() => {
    savedConfig = null;
    vi.mocked(readFileSync).mockImplementation(() =>
      JSON.stringify(savedConfig ?? baseConfig()),
    );
    vi.mocked(writeFileSync).mockImplementation((_path, data) => {
      savedConfig = JSON.parse(data as string);
    });
    clawConfigService = new ClawConfigService();
    service = new TeamsService(clawConfigService);
  });

  it('findAll returns teams list', () => {
    expect(service.findAll()).toEqual([]);
  });

  it('create adds a team and persists it', () => {
    const created = service.create({
      name: 'dev-team',
      description: 'desc',
      supervisor: 'sup',
      workers: ['coder', 'reviewer'],
      mode: 'hierarchy',
    });
    expect(created.name).toBe('dev-team');
    expect(created.supervisor).toBe('sup');
    expect(created.workers).toEqual(['coder', 'reviewer']);
    expect(created.active).toBe(1);
    expect(savedConfig.teams).toHaveLength(1);
    expect(savedConfig.teams[0].name).toBe('dev-team');
    expect(savedConfig.teams[0].createdAt).toBeTruthy();
  });

  it('create rejects duplicate name with ConflictException', () => {
    service.create({
      name: 'dup', description: '', supervisor: 'sup', workers: ['coder'], mode: 'hierarchy',
    });
    expect(() =>
      service.create({
        name: 'dup', description: '', supervisor: 'sup', workers: ['coder'], mode: 'hierarchy',
      }),
    ).toThrow(ConflictException);
  });

  it('create rejects dangling supervisor reference', () => {
    expect(() =>
      service.create({
        name: 't', description: '', supervisor: 'ghost', workers: ['coder'], mode: 'hierarchy',
      }),
    ).toThrow(BadRequestException);
  });

  it('create rejects dangling worker reference', () => {
    expect(() =>
      service.create({
        name: 't', description: '', supervisor: 'sup', workers: ['coder', 'ghost'], mode: 'hierarchy',
      }),
    ).toThrow(BadRequestException);
  });

  it('findOne throws NotFoundException when missing', () => {
    expect(() => service.findOne('nope')).toThrow(NotFoundException);
  });

  it('update modifies an existing team', () => {
    service.create({
      name: 't', description: 'old', supervisor: 'sup', workers: ['coder'], mode: 'hierarchy',
    });
    const updated = service.update('t', { description: 'new' });
    expect(updated.description).toBe('new');
    expect(typeof updated.updatedAt).toBe('string');
    expect(updated.updatedAt!.length).toBeGreaterThan(0);
  });

  it('remove deletes an existing team', () => {
    service.create({
      name: 't', description: '', supervisor: 'sup', workers: ['coder'], mode: 'hierarchy',
    });
    service.remove('t');
    expect(() => service.findOne('t')).toThrow(NotFoundException);
  });

  it('remove throws NotFoundException when missing', () => {
    expect(() => service.remove('nope')).toThrow(NotFoundException);
  });
});
