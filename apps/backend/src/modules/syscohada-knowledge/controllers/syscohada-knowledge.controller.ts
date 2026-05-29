import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import {
  SyscohadaControlWithEvidence,
  SyscohadaDomain,
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
  SyscohadaSearchResult,
} from '../services/syscohada-knowledge.service';

export interface ListSyscohadaDomainsResponse {
  readonly domains: ReadonlyArray<SyscohadaModuleGuidance>;
}

export interface SearchSyscohadaKnowledgeQuery {
  readonly query?: string;
  readonly domain?: string;
  readonly limit?: string | number;
}

export interface SearchSyscohadaKnowledgeResponse {
  readonly results: ReadonlyArray<SyscohadaSearchResult>;
}

export interface ListSyscohadaControlsResponse {
  readonly domain: SyscohadaDomain;
  readonly controls: ReadonlyArray<SyscohadaControlWithEvidence>;
}

@ApiTags('SYSCOHADA Knowledge')
@Controller('syscohada-knowledge')
export class SyscohadaKnowledgeController {
  constructor(private readonly knowledge: SyscohadaKnowledgeService) {}

  @Get('domains')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liste les domaines métiers reliés aux PDF du Guide SYSCOHADA.',
  })
  @ApiOkResponse({ description: 'Domaines avec références et extraits sourcés.' })
  listDomains(): ListSyscohadaDomainsResponse {
    return {
      domains: this.knowledge
        .getSupportedDomains()
        .map((domain) => this.knowledge.getModuleGuidance(domain)),
    };
  }

  @Get('domains/:domain')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retourne les références SYSCOHADA d’un domaine métier.',
  })
  getDomain(@Param('domain') domain: string): SyscohadaModuleGuidance {
    return this.knowledge.getModuleGuidance(this.parseDomain(domain));
  }

  @Get('domains/:domain/controls')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liste les contrôles SYSCOHADA d’un domaine, avec base légale et extrait sourcé.',
  })
  @ApiOkResponse({ description: 'Contrôles métier rattachés à leur citation du Guide.' })
  getDomainControls(@Param('domain') domain: string): ListSyscohadaControlsResponse {
    return {
      domain: this.parseDomain(domain),
      controls: this.knowledge.getModuleControls(this.parseDomain(domain)),
    };
  }

  @Get('search')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recherche des extraits citables dans le Guide d’application SYSCOHADA.',
  })
  search(@Query() query: SearchSyscohadaKnowledgeQuery): SearchSyscohadaKnowledgeResponse {
    return {
      results: this.knowledge.search({
        query: query.query ?? '',
        domain: query.domain ? this.parseDomain(query.domain) : undefined,
        limit: this.parseLimit(query.limit),
      }),
    };
  }

  private parseDomain(domain: string): SyscohadaDomain {
    const supported = this.knowledge.getSupportedDomains();
    if (!supported.includes(domain as SyscohadaDomain)) {
      throw new BadRequestException(
        `Domaine SYSCOHADA non supporté. Domaines: ${supported.join(', ')}`,
      );
    }
    return domain as SyscohadaDomain;
  }

  private parseLimit(limit: string | number | undefined): number {
    const parsed = Number(limit ?? 5);
    if (!Number.isFinite(parsed)) return 5;
    return Math.min(Math.max(Math.trunc(parsed), 1), 10);
  }
}
