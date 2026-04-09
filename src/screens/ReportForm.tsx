import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type Props = { onClose: () => void };

export default function ReportForm({ onClose }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Report Trash</Text>
      <Text style={styles.note}>This is a minimal stub for the report form.</Text>

      <TouchableOpacity style={styles.close} onPress={onClose}>
        <Text style={{ color: 'white' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  note: { color: '#666', marginBottom: 20 },
  close: { backgroundColor: '#e53e3e', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 }
});
