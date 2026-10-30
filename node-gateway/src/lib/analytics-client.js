import grpc from "@grpc/grpc-js";
import loader from "@grpc/proto-loader";

export function createAnalyticsClient({ address, protoPath }) {
  const definition = loader.loadSync(protoPath, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const packages = grpc.loadPackageDefinition(definition);
  const service = packages.smm?.v1?.MarketAnalytics;
  if (!service) {
    throw new Error(`MarketAnalytics service not found in ${protoPath}`);
  }

  const client = new service(address, grpc.credentials.createInsecure(), {
    "grpc.max_receive_message_length": 8 * 1024 * 1024,
    "grpc.keepalive_time_ms": 30_000,
  });

  function unary(method, request, timeoutMs) {
    return new Promise((resolve, reject) => {
      client[method](request, { deadline: Date.now() + timeoutMs }, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  return {
    analyze(request, timeoutMs = 5000) {
      return unary("Analyze", request, timeoutMs);
    },
    health(timeoutMs = 2000) {
      return unary("Health", {}, timeoutMs);
    },
    close() {
      client.close();
    },
  };
}
