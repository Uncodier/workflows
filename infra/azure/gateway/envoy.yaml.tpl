admin:
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 9901

static_resources:
  listeners:
    - name: grpc_tls
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 7233
      per_connection_buffer_limit_bytes: 1048576
      filter_chains:
        - transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                alpn_protocols: ["h2"]
                tls_certificates:
                  - certificate_chain:
                      filename: /etc/tls/tls.crt
                    private_key:
                      filename: /etc/tls/tls.key
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: temporal_grpc
                codec_type: HTTP2
                stream_idle_timeout: 0s
                request_timeout: 0s
                http2_protocol_options:
                  max_concurrent_streams: 128
                  initial_stream_window_size: 65536
                  initial_connection_window_size: 1048576
                route_config:
                  name: temporal
                  virtual_hosts:
                    - name: temporal
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/"
                          route:
                            cluster: temporal_frontend
                            timeout: 0s
                            idle_timeout: 0s
                            max_stream_duration:
                              grpc_timeout_header_max: 0s
                http_filters:
                  - name: envoy.filters.http.lua
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                      default_source_code:
                        inline_string: |
                          function envoy_on_request(request_handle)
                            local expected = "Bearer __GATEWAY_API_KEY__"
                            local auth = request_handle:headers():get("authorization") or ""
                            if auth ~= expected then
                              request_handle:respond({
                                [":status"] = "401",
                                ["grpc-status"] = "16",
                                ["grpc-message"] = "UNAUTHENTICATED",
                                ["content-type"] = "application/grpc"
                              }, "")
                            end
                            request_handle:headers():remove("authorization")
                          end
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
    - name: temporal_frontend
      type: STRICT_DNS
      connect_timeout: 5s
      lb_policy: ROUND_ROBIN
      circuit_breakers:
        thresholds:
          - max_connections: 256
            max_pending_requests: 128
            max_requests: 512
            max_retries: 3
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options:
              max_concurrent_streams: 128
      load_assignment:
        cluster_name: temporal_frontend
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: __TEMPORAL_FRONTEND_HOST__
                      port_value: 7233
