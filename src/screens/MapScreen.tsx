import React, { useState } from 'react';
import { View, StyleSheet, Modal, Text, TouchableOpacity } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import ReportForm from './ReportForm';

const SAMPLE_MARKERS = [
  { id: '1', lat: 39.9496, lng: -75.1503, severity: 'trashy' },
  { id: '2', lat: 39.9508, lng: -75.1520, severity: 'light' }
];

export default function MapScreen() {
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ latitude: 39.95, longitude: -75.15, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
      >
        {SAMPLE_MARKERS.map(m => (
          <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }}>
            <View style={styles.marker}>
              <Text style={{ color: 'white' }}>🗑️</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>Report</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide">
        <ReportForm onClose={() => setModalVisible(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  marker: { backgroundColor: '#2f855a', padding: 6, borderRadius: 6 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 40,
    backgroundColor: '#3182ce',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24
  },
  fabText: { color: 'white', fontWeight: '600' }
});
