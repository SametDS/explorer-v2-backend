import express, {Router} from 'express'
import compression from 'compression'
import {config} from 'src/config'
import http, {Server} from 'http'
import bodyParser from 'body-parser'
import cors from 'cors'
import {Request, Response} from 'express'
import rateLimit from 'express-rate-limit'
import {logger} from 'src/logger'
import {blockRouter} from 'src/api/rest/routes/block'
import {transactionRouter} from 'src/api/rest/routes/transaction'
import {stakingTransactionRouter} from 'src/api/rest/routes/stakingTransaction'
import {addressRouter} from 'src/api/rest/routes/address'
import {internalTransactionRouter} from 'src/api/rest/routes/internalTransaction'
import {signatureRouter} from 'src/api/rest/routes/signature'
import {logsRouter} from 'src/api/rest/routes/logs'
import {priceRouter} from 'src/api/rest/routes/price'
import {metricsRouter} from 'src/api/rest/routes/metrics'
import {erc20Router} from 'src/api/rest/routes/ERC20'
import {erc721Router} from 'src/api/rest/routes/ERC721'
import {erc1155Router} from 'src/api/rest/routes/ERC1155'
import {warmUpCache} from 'src/api/controllers/cache/warmUpCache'
import {rpcRouter} from 'src/api/rest/routes/rpcRouter'
import {adminRouter} from 'src/api/rest/routes/admin'

import {transport} from 'src/api/rest/transport'
import prometheusRegister from 'src/api/prometheus'
import {verifyAdminApiKey, verifyApiKey} from 'src/api/middlewares/verifyApiKey'
import {apiRouter} from 'src/api/rest/routes/api'
const l = logger(module)

export const RESTServer = async () => {
  if (!config.api.rest.isEnabled) {
    l.debug(`REST API is disabled`)
    return
  }

  const api = express()
  api.use(compression())
  api.use(cors())
  api.use(bodyParser.json())
  api.disable('x-powered-by')

  if (config.api.rest.rateLimiter.isEnabled) {
    const {windowMs, max} = config.api.rest.rateLimiter
    const rateLimiterParams = {
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
    }
    l.info(`Init REST API rate limiter with params: ${JSON.stringify(rateLimiterParams)}`)
    api.use(rateLimit(rateLimiterParams))
  } else {
    l.info(`REST API rate limiter is disabled in config [API_RATE_LIMITER_IS_ENABLED]`)
  }

  const mainRouter0 = Router({mergeParams: true})
  mainRouter0.use('/block', blockRouter)
  mainRouter0.use('/transaction', transactionRouter)
  mainRouter0.use('/stakingTransaction', stakingTransactionRouter)
  mainRouter0.use('/address', addressRouter)
  mainRouter0.use('/internalTransaction', internalTransactionRouter)
  mainRouter0.use('/logs', logsRouter)
  mainRouter0.use('/erc20', erc20Router, transport)
  mainRouter0.use('/erc721', erc721Router, transport)
  mainRouter0.use('/erc1155', erc1155Router, transport)

  const routerWithShards0 = Router({mergeParams: true})
  routerWithShards0.use('/shard/:shardID', mainRouter0, transport)
  routerWithShards0.use('/signature', signatureRouter, transport)
  routerWithShards0.use('/price', priceRouter, transport)
  routerWithShards0.use('/metrics', metricsRouter, transport)

  if (config.api.json_rpc.isEnabled) {
    routerWithShards0.use('/rpc', rpcRouter, transport)
  } else {
    l.debug(`RPC API is disabled`)
  }

  api.use('/v0', verifyApiKey, routerWithShards0)
  api.use(
    '/metrics',
    async (req: Request, res: Response) => {
      res.setHeader('Content-Type', prometheusRegister.contentType)
      res.end(await prometheusRegister.metrics())
    },
    transport
  )
  api.use('/api', apiRouter, transport)
  api.use('/admin', verifyAdminApiKey, adminRouter, transport)

  let server: Server

  const close = () => server.close()

  l.info('REST API starting...')
  try {
    server = http.createServer(api).listen(config.api.rest.port, () => {
      l.info(`REST API listening at http://localhost:${config.api.rest.port}`)
    })
  } catch (error) {
    l.error('Error when starting up API', {error})
  }

  return close
}
