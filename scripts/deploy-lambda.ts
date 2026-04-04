import path from 'path';
import dotenv from 'dotenv';
import { deployFunction, deploySite, getOrCreateBucket } from '@remotion/lambda';

dotenv.config();

async function main() {
  const region = (process.env.AWS_REGION || 'us-east-1') as any;
  const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.ts');

  console.log('[remotion] preparando bucket na regiao', region);
  const { bucketName } = await getOrCreateBucket({ region });

  console.log('[remotion] fazendo deploy do bundle para S3...');
  const site = await deploySite({
    region,
    bucketName,
    entryPoint,
    siteName: `video-editor-${Date.now()}`,
  });

  console.log('[remotion] fazendo deploy da funcao Lambda...');
  const lambdaFn = await deployFunction({
    region,
    timeoutInSeconds: 300,
    memorySizeInMb: 2048,
    createCloudWatchLogGroup: true,
  });

  console.log('\n=== Variaveis de ambiente ===');
  console.log(`AWS_REGION=${region}`);
  console.log(`REMOTION_AWS_FUNCTION_NAME=${lambdaFn.functionName}`);
  console.log(`REMOTION_AWS_SERVE_URL=${site.serveUrl}`);
  console.log('AWS_ACCESS_KEY_ID=<sua-chave>');
  console.log('AWS_SECRET_ACCESS_KEY=<seu-segredo>');
}

main().catch((error) => {
  console.error('[remotion] erro no deploy:', error);
  process.exit(1);
});
