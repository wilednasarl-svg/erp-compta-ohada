import { ApiProperty } from '@nestjs/swagger';

import type { RuleAction, RuleCondition, RuleMatch, RuleScope } from '../../types/rule.types';
import type { RuleExecutionMode } from '../../entities/rule-execution.entity';

export class RuleResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ nullable: true, type: String })
  description!: string | null;
  @ApiProperty()
  isActive!: boolean;
  @ApiProperty()
  priority!: number;
  @ApiProperty({ type: 'object', isArray: true })
  conditions!: RuleCondition[];
  @ApiProperty({ type: 'object', isArray: true })
  actions!: RuleAction[];
  @ApiProperty({ format: 'uuid' })
  createdById!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  updatedById!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class RuleEnvelopeResponse {
  @ApiProperty({ type: () => RuleResponse })
  rule!: RuleResponse;
}

export class ListRulesResponse {
  @ApiProperty({ type: () => [RuleResponse] })
  rules!: RuleResponse[];
}

export class RuleExecutionEntityResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  ruleId!: string;
  @ApiProperty({ enum: ['simulation', 'apply'] })
  mode!: RuleExecutionMode;
  @ApiProperty({ type: 'object' })
  scope!: RuleScope;
  @ApiProperty()
  matchedCount!: number;
  @ApiProperty()
  appliedCount!: number;
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  transformationIds!: string[];
  @ApiProperty({ type: 'object', isArray: true })
  matchesSnapshot!: RuleMatch[];
  @ApiProperty({ nullable: true, type: String })
  error!: string | null;
  @ApiProperty({ format: 'uuid' })
  executedById!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class ListRuleExecutionsResponse {
  @ApiProperty({ type: () => [RuleExecutionEntityResponse] })
  executions!: RuleExecutionEntityResponse[];
}

export class RuleExecutionResultResponse {
  @ApiProperty({ format: 'uuid' })
  ruleId!: string;
  @ApiProperty({ enum: ['simulation', 'apply'] })
  mode!: RuleExecutionMode;
  @ApiProperty()
  matchedCount!: number;
  @ApiProperty()
  appliedCount!: number;
  @ApiProperty({ type: 'object', isArray: true })
  matches!: RuleMatch[];
  @ApiProperty({ nullable: true, type: String })
  error!: string | undefined;
}
