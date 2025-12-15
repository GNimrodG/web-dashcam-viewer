import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import ModalClose from "@mui/joy/ModalClose";
import Typography from "@mui/joy/Typography";
import Table from "@mui/joy/Table";
import Sheet from "@mui/joy/Sheet";
import Chip from "@mui/joy/Chip";
import Box from "@mui/joy/Box";
import CircularProgress from "@mui/joy/CircularProgress";
import { useEffect, useState, type FunctionComponent, useRef } from "react";
import { type GpsQueueStatus } from "../api";
import moment from "moment";

interface GpsQueueModalProps {
  open: boolean;
  onClose: () => void;
}

const GpsQueueModal: FunctionComponent<GpsQueueModalProps> = ({
  open,
  onClose,
}) => {
  const [status, setStatus] = useState<GpsQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!open) {
      // Close any existing connection when modal is closed
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus(null);
      setLoading(true);
      setError(null);
      return;
    }

    // Create EventSource connection
    const eventSource = new EventSource("/api/videos/gps-queue-status");
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: GpsQueueStatus = JSON.parse(event.data);
        setStatus(data);
        setLoading(false);
        setError(null);
      } catch (err) {
        console.error("Failed to parse GPS queue status:", err);
        setError("Failed to parse queue status");
      }
    };

    eventSource.onerror = (err) => {
      console.error("EventSource error:", err);
      setError("Connection error. Retrying...");
      setLoading(false);
    };

    // Cleanup on unmount or when open changes
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [open]);

  const formatPairId = (id: string) => {
    const [datePart, timePart] = id.split("_");
    if (!datePart || !timePart || datePart.length !== 8 || timePart.length < 6)
      return id;
    const yyyy = datePart.slice(0, 4);
    const mm = datePart.slice(4, 6);
    const dd = datePart.slice(6, 8);
    const hh = timePart.slice(0, 2);
    const mi = timePart.slice(2, 4);
    const ss = timePart.slice(4, 6);
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          minWidth: { xs: "90vw", md: "600px" },
          maxWidth: "min(90vw, 800px)",
          height: { xs: "90vh", md: "60vh" },
        }}>
        <ModalClose />
        <Typography level="h4" sx={{ mb: 2 }}>
          GPS Extraction Queue
        </Typography>

        {loading && !status && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Typography level="body-md" color="danger" sx={{ p: 2 }}>
            {error}
          </Typography>
        )}

        {status && (
          <>
            <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
              <Chip variant="soft" color="primary">
                Limit: {status.limit}
              </Chip>
              <Chip variant="soft" color="success">
                Processing: {status.processing.length}
              </Chip>
              <Chip variant="soft" color="neutral">
                Queued: {status.queued.length}
              </Chip>
            </Box>

            <Sheet
              variant="outlined"
              sx={{
                borderRadius: "sm",
                overflow: "auto",
                flex: 1,
              }}>
              <Table
                stickyHeader
                hoverRow
                borderAxis="xBetween"
                sx={{
                  "& thead th": {
                    backgroundColor: "background.surface",
                  },
                }}>
                <thead>
                  <tr>
                    <th style={{ width: "60%" }}>Video ID</th>
                    <th style={{ width: "20%" }}>Status</th>
                    <th style={{ width: "20%" }}>Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {status.processing.map((id) => (
                    <tr key={`processing-${id}`}>
                      <td>{formatPairId(id)}</td>
                      <td>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                          }}>
                          <CircularProgress size="sm" color="success" />
                          <Chip size="sm" variant="soft" color="success">
                            Processing
                          </Chip>
                        </Box>
                      </td>
                      <td>-</td>
                    </tr>
                  ))}
                  {status.queued.map((item, index) => (
                    <tr key={`queued-${item.id}`}>
                      <td>{formatPairId(item.id)}</td>
                      <td>
                        <Chip size="sm" variant="outlined" color="neutral">
                          Pending (#{index + 1})
                        </Chip>
                      </td>
                      <td>{moment(item.queuedAt).fromNow()}</td>
                    </tr>
                  ))}
                  {status.processing.length === 0 &&
                    status.queued.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ textAlign: "center" }}>
                          <Typography level="body-sm" sx={{ py: 2 }}>
                            No active GPS extractions
                          </Typography>
                        </td>
                      </tr>
                    )}
                </tbody>
              </Table>
            </Sheet>
          </>
        )}
      </ModalDialog>
    </Modal>
  );
};

export default GpsQueueModal;
