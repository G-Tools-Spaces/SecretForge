import { Global, Module } from '@nestjs/common';
import { MasterKeyService } from './master-key.service';
import { EnvelopeEncryptionService } from './envelope-encryption.service';
import { EnvService } from '../config/env.service';

export const MASTER_KEY = Symbol('MASTER_KEY');

@Global()
@Module({
  providers: [
    {
      provide: MasterKeyService,
      inject: [EnvService],
      useFactory: (env: EnvService) => new MasterKeyService(env.masterKey),
    },
    EnvelopeEncryptionService,
  ],
  exports: [MasterKeyService, EnvelopeEncryptionService],
})
export class CryptoModule {}
