import { Global, Module } from '@nestjs/common';

import { SyscohadaKnowledgeController } from './controllers/syscohada-knowledge.controller';
import { SyscohadaKnowledgeService } from './services/syscohada-knowledge.service';

@Global()
@Module({
  controllers: [SyscohadaKnowledgeController],
  providers: [SyscohadaKnowledgeService],
  exports: [SyscohadaKnowledgeService],
})
export class SyscohadaKnowledgeModule {}
