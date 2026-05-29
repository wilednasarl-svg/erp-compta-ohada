import { Global, Module } from '@nestjs/common';

import { SyscohadaKnowledgeService } from './services/syscohada-knowledge.service';

@Global()
@Module({
  providers: [SyscohadaKnowledgeService],
  exports: [SyscohadaKnowledgeService],
})
export class SyscohadaKnowledgeModule {}
